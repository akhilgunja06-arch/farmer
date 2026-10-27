import multer from 'multer';
import type { Request } from 'express';
import { HttpError } from '../db/pool.js';

/**
 * Multipart upload handling.
 *
 * The field name is deliberately not pinned. Browsers put the file in whichever
 * field the client code names — the product form uses `image`, the review form
 * uses `photo` — and a mismatch here fails *after* the request has been parsed,
 * producing an unhelpful 500 from the route. Accepting any single field and
 * validating the bytes in the storage layer is both simpler and safer: the
 * file's magic bytes are what decide whether it is allowed, never its name.
 *
 * Memory storage with a 50 MB backstop; the per-kind limits in
 * services/storage.ts are the real enforcement.
 */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
});

export const anySingleFile = upload.any();

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * Read the single file that multer buffered.
 *
 * `upload.any()` populates `req.files`, which may be an array or an object
 * depending on how it was called, so both shapes are handled.
 */
export function readUpload(req: Request): UploadedFile {
  const files = (req as Request & { files?: unknown }).files;

  if (Array.isArray(files) && files.length > 0) {
    const first = files[0] as UploadedFile;
    if (files.length > 1) {
      throw new HttpError(400, 'Send one file at a time.', 'TOO_MANY_FILES');
    }
    return first;
  }

  if (files && typeof files === 'object') {
    const values = Object.values(files as Record<string, UploadedFile[]>).flat();
    if (values.length > 0) {
      if (values.length > 1) {
        throw new HttpError(400, 'Send one file at a time.', 'TOO_MANY_FILES');
      }
      return values[0]!;
    }
  }

  // multer.single() would place it here; kept so either middleware works.
  const single = (req as Request & { file?: UploadedFile }).file;
  if (single) return single;

  throw new HttpError(400, 'No file was uploaded.', 'NO_FILE');
}
