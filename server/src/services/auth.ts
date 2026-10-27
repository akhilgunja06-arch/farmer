import { HttpError, currentClient } from '../db/pool.js';
import {
  burnPasswordTime,
  generateToken,
  hashPassword,
  hashToken,
  validatePasswordStrength,
  verifyPassword,
} from '../lib/passwords.js';
import { sendPasswordResetEmail, sendVerificationEmail } from './email.js';
import { audit, q, q1 } from './helpers.js';

export interface RegisterFarmerInput {
  email: string;
  password: string;
  full_name: string;
  phone: string;
  preferred_language: 'en' | 'te' | 'hi';
  farm_name?: string;
  state: string;
  district: string;
  village: string;
  public_address?: string;
  latitude?: number | null;
  longitude?: number | null;
  location_public?: boolean;
  farming_type?: string[];
  crops_cultivated?: string[];
  bio?: string;
  profile_photo?: string | null;
  offers_delivery?: boolean;
  offers_pickup?: boolean;
  accepted_terms: boolean;
}

export interface RegisterCustomerInput {
  email: string;
  password: string;
  full_name: string;
  phone: string;
  preferred_language: 'en' | 'te' | 'hi';
  state: string;
  district: string;
  village?: string;
  delivery_address: string;
  postal_code?: string;
  profile_photo?: string | null;
  accepted_terms: boolean;
}

interface Credentials {
  id: string;
  email: string;
  password_hash: string;
  role: 'farmer' | 'customer' | 'admin';
  email_verified: boolean;
  is_suspended: boolean;
  full_name: string;
  preferred_language: 'en' | 'te' | 'hi';
  suspended_reason: string | null;
}

/**
 * Fetch credentials for login.
 *
 * Goes through the SECURITY DEFINER function because the runtime role has no
 * SELECT privilege on profiles.password_hash. That grant is deliberate: even a
 * SQL injection that reached the API could not read a hash.
 */
async function getCredentials(email: string): Promise<Credentials | null> {
  const rows = await q<Credentials>('SELECT * FROM auth_get_credentials($1)', [email]);
  return rows[0] ?? null;
}

async function issueEmailToken(userId: string, purpose: 'email_verify' | 'password_reset') {
  const { raw, hash } = generateToken();
  const ttlHours = purpose === 'email_verify' ? 24 : 1;
  const expiresAt = new Date(Date.now() + ttlHours * 3600_000);
  await q('SELECT auth_create_token($1, $2, $3, $4)', [userId, purpose, hash, expiresAt]);
  return raw;
}

/**
 * Create a farmer account.
 *
 * Both the profile row and the farmer_profiles row are written in the caller's
 * transaction, so a failure part-way through leaves no half-built account.
 */
export async function registerFarmer(input: RegisterFarmerInput, meta: {
  ip: string | null; userAgent: string | null;
}) {
  const passwordError = validatePasswordStrength(input.password);
  if (passwordError) throw new HttpError(422, passwordError, 'WEAK_PASSWORD', { password: passwordError });
  if (!input.accepted_terms) {
    throw new HttpError(422, 'Please accept the terms to continue.', 'TERMS_REQUIRED', {
      accepted_terms: 'You must accept the terms of use and privacy policy.',
    });
  }

  const existing = await q1<{ id: string }>('SELECT id FROM profiles WHERE email = $1', [input.email]);
  if (existing) {
    throw new HttpError(
      409,
      'An account already exists for this email address. Try signing in instead.',
      'EMAIL_TAKEN',
      { email: 'This email is already registered.' },
    );
  }

  const passwordHash = await hashPassword(input.password);

  const created = await q1<{ id: string }>(
    `INSERT INTO profiles (email, password_hash, full_name, phone, preferred_language, role, profile_photo)
     VALUES ($1, $2, $3, $4, $5, 'farmer', $6)
     RETURNING id`,
    [input.email, passwordHash, input.full_name, input.phone, input.preferred_language, input.profile_photo ?? null],
  );
  if (!created) throw new HttpError(500, 'The account could not be created.', 'CREATE_FAILED');
  const userId = created.id;

  await q(
    `INSERT INTO farmer_profiles
       (user_id, farm_name, state, district, village, public_address,
        latitude, longitude, location_public, farming_type, crops_cultivated, bio,
        offers_delivery, offers_pickup)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      userId,
      input.farm_name ?? null,
      input.state,
      input.district,
      input.village,
      input.public_address ?? null,
      input.latitude ?? null,
      input.longitude ?? null,
      input.location_public ?? false,
      input.farming_type ?? [],
      input.crops_cultivated ?? [],
      input.bio ?? null,
      input.offers_delivery ?? false,
      input.offers_pickup ?? true,
    ],
  );

  await recordConsents(userId, meta);

  const rawToken = await issueEmailToken(userId, 'email_verify');
  await sendVerificationEmail(input.email, rawToken, input.full_name);

  await audit({
    action: 'user.register',
    entityType: 'profile',
    entityId: userId,
    after: { role: 'farmer', email: input.email },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return { userId, role: 'farmer' as const, verificationToken: rawToken };
}

/** Create a customer account, with a default delivery address. */
export async function registerCustomer(input: RegisterCustomerInput, meta: {
  ip: string | null; userAgent: string | null;
}) {
  const passwordError = validatePasswordStrength(input.password);
  if (passwordError) throw new HttpError(422, passwordError, 'WEAK_PASSWORD', { password: passwordError });
  if (!input.accepted_terms) {
    throw new HttpError(422, 'Please accept the terms to continue.', 'TERMS_REQUIRED', {
      accepted_terms: 'You must accept the terms of use and privacy policy.',
    });
  }

  const existing = await q1<{ id: string }>('SELECT id FROM profiles WHERE email = $1', [input.email]);
  if (existing) {
    throw new HttpError(
      409,
      'An account already exists for this email address. Try signing in instead.',
      'EMAIL_TAKEN',
      { email: 'This email is already registered.' },
    );
  }

  const passwordHash = await hashPassword(input.password);

  const created = await q1<{ id: string }>(
    `INSERT INTO profiles (email, password_hash, full_name, phone, preferred_language, role, profile_photo)
     VALUES ($1, $2, $3, $4, $5, 'customer', $6)
     RETURNING id`,
    [input.email, passwordHash, input.full_name, input.phone, input.preferred_language, input.profile_photo ?? null],
  );
  if (!created) throw new HttpError(500, 'The account could not be created.', 'CREATE_FAILED');
  const userId = created.id;

  await q(
    `INSERT INTO customer_addresses
       (customer_id, label, recipient_name, phone, address_line, state, district, village, postal_code, is_default)
     VALUES ($1, 'Home', $2, $3, $4, $5, $6, $7, $8, true)`,
    [
      userId,
      input.full_name,
      input.phone,
      input.delivery_address,
      input.state,
      input.district,
      input.village ?? null,
      input.postal_code ?? null,
    ],
  );

  await recordConsents(userId, meta);

  const rawToken = await issueEmailToken(userId, 'email_verify');
  await sendVerificationEmail(input.email, rawToken, input.full_name);

  await audit({
    action: 'user.register',
    entityType: 'profile',
    entityId: userId,
    after: { role: 'customer', email: input.email },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return { userId, role: 'customer' as const, verificationToken: rawToken };
}

async function recordConsents(
  userId: string,
  meta: { ip: string | null; userAgent: string | null },
) {
  const client = currentClient();
  for (const consentType of ['terms_of_use', 'privacy_policy']) {
    await client.query(
      `INSERT INTO user_consents (user_id, consent_type, version, granted, ip_address, user_agent)
       VALUES ($1, $2, '1.0', true, $3, $4)`,
      [userId, consentType, meta.ip, meta.userAgent],
    );
  }
}

export interface LoginResult {
  userId: string;
  role: 'farmer' | 'customer' | 'admin';
  fullName: string;
  email: string;
  preferredLanguage: string;
  emailVerified: boolean;
  profilePhoto: string | null;
}

/**
 * Authenticate an email and password.
 *
 * The same generic message is returned for an unknown email, a wrong password,
 * and a disabled account, so the response cannot be used to enumerate which
 * addresses are registered.
 */
export async function login(
  email: string,
  password: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<LoginResult> {
  const creds = await getCredentials(email);

  if (!creds) {
    // Spend comparable time so latency does not reveal that the email is unused.
    await burnPasswordTime(password);
    throw invalidCredentials();
  }

  const ok = await verifyPassword(password, creds.password_hash);
  if (!ok) {
    await audit({
      action: 'user.login_failed',
      entityType: 'profile',
      entityId: creds.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    throw invalidCredentials();
  }

  if (creds.is_suspended) {
    throw new HttpError(
      403,
      'This account has been suspended. Please contact support.',
      'ACCOUNT_SUSPENDED',
    );
  }

  await q('UPDATE profiles SET last_login_at = now() WHERE id = $1', [creds.id]);

  await audit({
    action: 'user.login',
    entityType: 'profile',
    entityId: creds.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  const profile = await q1<{ profile_photo: string | null }>(
    'SELECT profile_photo FROM profiles WHERE id = $1',
    [creds.id],
  );

  return {
    userId: creds.id,
    role: creds.role,
    fullName: creds.full_name,
    email: creds.email,
    preferredLanguage: creds.preferred_language,
    emailVerified: creds.email_verified,
    profilePhoto: profile?.profile_photo ?? null,
  };
}

function invalidCredentials(): HttpError {
  return new HttpError(
    401,
    'The email address or password is not correct.',
    'INVALID_CREDENTIALS',
    { email: 'Check your email address.', password: 'Check your password.' },
  );
}

/**
 * Begin a password reset.
 *
 * Always resolves, whether or not the address exists. Telling the caller that
 * an email is unregistered would turn this endpoint into an account-enumeration
 * oracle. The real work only happens for a genuine account.
 */
export async function requestPasswordReset(email: string): Promise<{ token?: string }> {
  const creds = await getCredentials(email);
  if (!creds) return {};
  if (creds.is_suspended) return {};

  const rawToken = await issueEmailToken(creds.id, 'password_reset');
  await sendPasswordResetEmail(creds.email, rawToken, creds.full_name);

  return { token: rawToken };
}

export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  const passwordError = validatePasswordStrength(newPassword);
  if (passwordError) throw new HttpError(422, passwordError, 'WEAK_PASSWORD', { password: passwordError });

  const tokenHash = hashToken(rawToken);
  // Single use: the function marks it spent as part of the same statement that
  // returns the user id, so two concurrent requests cannot both redeem it.
  const rows = await q<{ auth_consume_token: string | null }>(
    'SELECT auth_consume_token($1, $2)',
    [tokenHash, 'password_reset'],
  );
  const userId = rows[0]?.auth_consume_token ?? null;

  if (!userId) {
    throw new HttpError(
      400,
      'This reset link is invalid or has expired. Please request a new one.',
      'TOKEN_INVALID',
    );
  }

  const passwordHash = await hashPassword(newPassword);
  await q('SELECT auth_set_password($1, $2)', [userId, passwordHash]);

  await audit({ action: 'user.password_reset', entityType: 'profile', entityId: userId });
}

export async function verifyEmail(rawToken: string): Promise<void> {
  const tokenHash = hashToken(rawToken);
  const rows = await q<{ auth_consume_token: string | null }>(
    'SELECT auth_consume_token($1, $2)',
    [tokenHash, 'email_verify'],
  );
  const userId = rows[0]?.auth_consume_token ?? null;

  if (!userId) {
    throw new HttpError(
      400,
      'This confirmation link is invalid or has expired.',
      'TOKEN_INVALID',
    );
  }

  await q('SELECT auth_mark_email_verified($1)', [userId]);
  await audit({ action: 'user.email_verified', entityType: 'profile', entityId: userId });
}

export async function resendVerification(userId: string): Promise<void> {
  const profile = await q1<{ email: string; full_name: string; email_verified: boolean }>(
    'SELECT email, full_name, email_verified FROM profiles WHERE id = $1',
    [userId],
  );
  if (!profile) throw new HttpError(404, 'Account not found.', 'NOT_FOUND');
  if (profile.email_verified) return;

  const rawToken = await issueEmailToken(userId, 'email_verify');
  await sendVerificationEmail(profile.email, rawToken, profile.full_name);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const passwordError = validatePasswordStrength(newPassword);
  if (passwordError) throw new HttpError(422, passwordError, 'WEAK_PASSWORD', { new_password: passwordError });

  const creds = await q1<{ password_hash: string }>(
    'SELECT password_hash FROM auth_get_credentials((SELECT email FROM profiles WHERE id = $1))',
    [userId],
  );
  if (!creds) throw new HttpError(404, 'Account not found.', 'NOT_FOUND');

  const ok = await verifyPassword(currentPassword, creds.password_hash);
  if (!ok) {
    throw new HttpError(400, 'Your current password is not correct.', 'WRONG_PASSWORD', {
      current_password: 'That password does not match our records.',
    });
  }

  const passwordHash = await hashPassword(newPassword);
  await q('SELECT auth_set_password($1, $2)', [userId, passwordHash]);
  await audit({ action: 'user.password_changed', entityType: 'profile', entityId: userId });
}
