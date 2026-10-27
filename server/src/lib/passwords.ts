import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 12;

/**
 * Hash a password. bcrypt is deliberately slow and salts each hash, so the
 * stored value is useless without the original input. The plaintext is never
 * written anywhere: not to the database, not to a log, not to an error.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

/**
 * Verify a password against a stored hash.
 *
 * bcrypt.compare is constant-time with respect to the hash, which keeps it from
 * leaking how many leading characters matched.
 */
export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}

/**
 * Burn roughly the same amount of time as a real bcrypt comparison.
 *
 * Called when an email address has no account, so that a login attempt against
 * a nonexistent user and one against a real user take a similar length of time.
 * Without this, response latency reveals which addresses are registered.
 */
const DUMMY_HASH = '$2a$12$0000000000000000000000000000000000000000000000000000';
export async function burnPasswordTime(plaintext: string): Promise<void> {
  await bcrypt.compare(plaintext, DUMMY_HASH).catch(() => false);
}

/**
 * Generate a single-use token for email verification or password reset.
 *
 * The raw value goes in the link; only its SHA-256 digest is stored. A leaked
 * database dump therefore contains no usable reset link. SHA-256 is right here
 * (rather than bcrypt) because the token is 32 bytes of CSPRNG output, so it
 * is not brute-forceable and does not need a slow hash.
 */
export function generateToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Constant-time string comparison for secrets of equal length. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * A password policy that is strict enough to matter and simple enough to
 * explain in one line of UI copy.
 */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters long.';
  if (password.length > 128) return 'Password must be 128 characters or fewer.';
  if (!/[a-zA-Z]/.test(password)) return 'Password must contain at least one letter.';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number.';
  if (/^(password|12345678|qwertyui|iloveyou|admin123)/i.test(password)) {
    return 'That password is too common. Please choose something less predictable.';
  }
  return null;
}
