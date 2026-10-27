import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { config } from '../config.js';
import { HttpError } from '../db/pool.js';

/**
 * File storage.
 *
 * Files are written under config.storageDir in a per-owner directory, and the
 * stored path is a relative key, never an absolute filesystem path. Reads go
 * through resolveStoragePath(), which refuses anything that escapes the storage
 * root — so a crafted key like "../../etc/passwd" cannot be used to read an
 * arbitrary file even if a bug let it reach the database.
 *
 * A production deployment would put the same interface in front of object
 * storage; only this module would change.
 */

/**
 * Allowed upload types.
 *
 * The check is on magic bytes, not just the declared content type or the file
 * extension: both of those are attacker-controlled, so a .jpg-named PHP script
 * would otherwise pass. Anything not recognised here is rejected outright.
 */
const SIGNATURES: Array<{ mime: string; ext: string; test: (b: Buffer) => boolean }> = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png', ext: 'png',
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mime: 'image/webp', ext: 'webp',
    test: (b) =>
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    mime: 'image/gif', ext: 'gif',
    test: (b) => b.subarray(0, 3).toString('ascii') === 'GIF',
  },
  {
    mime: 'video/mp4', ext: 'mp4',
    test: (b) => b.subarray(4, 8).toString('ascii') === 'ftyp',
  },
  {
    mime: 'application/pdf', ext: 'pdf',
    test: (b) => b.subarray(0, 5).toString('ascii') === '%PDF-',
  },
];

export type UploadKind = 'image' | 'video' | 'document';

const KIND_LIMITS: Record<UploadKind, { maxBytes: number; mimes: string[] }> = {
  image: { maxBytes: 8 * 1024 * 1024, mimes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] },
  video: { maxBytes: 48 * 1024 * 1024, mimes: ['video/mp4'] },
  document: { maxBytes: 12 * 1024 * 1024, mimes: ['application/pdf', 'image/jpeg', 'image/png'] },
};

export interface StoredFile {
  /** Relative storage key, safe to persist in the database. */
  key: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
}

/**
 * Validate and store an uploaded file.
 *
 * Returns a relative key. Nothing about the original filename is reused beyond
 * the extension we derived from the file's own bytes, so a filename containing
 * path separators or shell metacharacters cannot influence where the file lands.
 */
export async function storeUpload(
  ownerId: string,
  file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  kind: UploadKind,
  scope: string,
): Promise<StoredFile> {
  const limits = KIND_LIMITS[kind];

  if (!file.buffer || file.buffer.length === 0) {
    throw new HttpError(400, 'The uploaded file was empty.', 'EMPTY_FILE');
  }
  if (file.buffer.length > limits.maxBytes) {
    throw new HttpError(
      413,
      `That file is too large. The limit for ${kind} files is ${Math.round(limits.maxBytes / 1024 / 1024)} MB.`,
      'FILE_TOO_LARGE',
    );
  }

  const detected = SIGNATURES.find((sig) => sig.test(file.buffer));
  if (!detected) {
    throw new HttpError(
      415,
      'That file type is not supported. Upload a JPEG, PNG, WebP, GIF, MP4 or PDF file.',
      'UNSUPPORTED_FILE_TYPE',
    );
  }
  if (!limits.mimes.includes(detected.mime)) {
    throw new HttpError(
      415,
      `A ${detected.mime} file is not accepted here. Expected one of: ${limits.mimes.join(', ')}.`,
      'UNSUPPORTED_FILE_TYPE',
    );
  }

  const sha256 = createHash('sha256').update(file.buffer).digest('hex');

  // The path is built entirely from values we control: the owner's id (a UUID
  // from the session), a fixed scope word, a random name, and an extension
  // derived from the file's magic bytes.
  const safeScope = scope.replace(/[^a-z0-9_-]/gi, '').slice(0, 32) || 'general';
  const key = `${ownerId}/${safeScope}/${randomUUID()}.${detected.ext}`;
  const absolute = resolveStoragePath(key);

  await mkdir(join(config.storageDir, ownerId, safeScope), { recursive: true });
  await writeFile(absolute, file.buffer);

  return { key, mimeType: detected.mime, byteSize: file.buffer.length, sha256 };
}

/**
 * Turn a storage key into an absolute path inside the storage root.
 *
 * This is the single choke point for path traversal. `normalize` collapses
 * ".." segments and the prefix check then rejects anything that resolved
 * outside the root.
 */
export function resolveStoragePath(key: string): string {
  const root = resolve(config.storageDir);
  const candidate = resolve(root, normalize(key));

  if (candidate !== root && !candidate.startsWith(root + sep)) {
    throw new HttpError(400, 'That file reference is not valid.', 'INVALID_PATH');
  }
  return candidate;
}

export async function readStoredFile(key: string): Promise<{ buffer: Buffer; byteSize: number }> {
  const absolute = resolveStoragePath(key);
  try {
    const info = await stat(absolute);
    if (!info.isFile()) throw new Error('not a file');
    const buffer = await readFile(absolute);
    return { buffer, byteSize: info.size };
  } catch {
    throw new HttpError(404, 'That file could not be found.', 'FILE_NOT_FOUND');
  }
}

export async function deleteStoredFile(key: string): Promise<void> {
  try {
    await unlink(resolveStoragePath(key));
  } catch {
    // Already gone is the desired end state, so this is not an error.
  }
}

export function extensionFor(mime: string): string {
  return SIGNATURES.find((s) => s.mime === mime)?.ext ?? 'bin';
}

/** Guess a content type from a stored key, for serving the file back. */
export function mimeForKey(key: string): string {
  const ext = extname(key).slice(1).toLowerCase();
  const match = SIGNATURES.find((s) => s.ext === ext);
  return match?.mime ?? 'application/octet-stream';
}

/**
 * Is this key safe to hand to a browser?
 *
 * Inline rendering is only offered for images. A PDF is served as an
 * attachment, and anything else is not served at all — an inline HTML or SVG
 * response from our own origin would be a stored-XSS vector.
 */
export function isInlineSafe(key: string): boolean {
  const mime = mimeForKey(key);
  return mime.startsWith('image/');
}

export { KIND_LIMITS };
