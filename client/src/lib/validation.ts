import { z } from 'zod';

/**
 * Client-side validation.
 *
 * These mirror the server's schemas closely enough to catch mistakes before a
 * round trip, but the server remains the authority — it re-validates
 * everything, and its `fieldErrors` are what the forms display when the two
 * disagree.
 */

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Enter your email address.')
  .email('Enter a valid email address.')
  .max(254, 'That email address is too long.');

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(128, 'Password must be 128 characters or fewer.')
  .regex(/[A-Za-z]/, 'Password must include at least one letter.')
  .regex(/[0-9]/, 'Password must include at least one number.');

/** Indian mobile numbers, with or without +91 and spaces. */
export const phoneSchema = z
  .string()
  .trim()
  .min(1, 'Enter your mobile number.')
  .regex(/^[0-9+\- ]{8,15}$/, 'Enter a valid mobile number.');

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, 'Please enter your full name.')
  .max(120, 'That name is too long.');

export const stateSchema = z.string().trim().min(2, 'Please select a state.');
export const districtSchema = z.string().trim().min(2, 'Please select a district.');

export const postalCodeSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{6}$/, 'Enter a 6-digit PIN code.')
  .or(z.literal(''))
  .optional();

export const languageSchema = z.enum(['en', 'te', 'hi']);

export const farmerRegisterSchema = z.object({
  full_name: fullNameSchema,
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  state: stateSchema,
  district: districtSchema,
  village: z.string().trim().min(1, 'Enter your village or town.').max(120),
  public_address: z.string().trim().max(500).optional(),
  preferred_language: languageSchema,
  farm_name: z.string().trim().max(160).optional(),
  farming_type: z.string().trim().max(60).optional(),
  crops_cultivated: z.string().trim().max(400).optional(),
  offers_delivery: z.boolean(),
  offers_pickup: z.boolean(),
  location_public: z.boolean(),
  accepted_terms: z.literal(true, {
    errorMap: () => ({ message: 'Please accept the terms to continue.' }),
  }),
});

export const customerRegisterSchema = z.object({
  full_name: fullNameSchema,
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  state: stateSchema,
  district: districtSchema,
  village: z.string().trim().max(120).optional(),
  delivery_address: z
    .string()
    .trim()
    .min(5, 'Please enter your delivery address.')
    .max(500, 'That address is too long.'),
  postal_code: postalCodeSchema,
  preferred_language: languageSchema,
  accepted_terms: z.literal(true, {
    errorMap: () => ({ message: 'Please accept the terms to continue.' }),
  }),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirm_password: z.string().min(1, 'Please repeat the password.'),
  })
  .refine((values) => values.password === values.confirm_password, {
    message: 'The two passwords do not match.',
    path: ['confirm_password'],
  });

export const addressSchema = z.object({
  recipient_name: fullNameSchema,
  phone: phoneSchema,
  address: z.string().trim().min(5, 'Please enter the full address.').max(500),
  state: stateSchema,
  district: districtSchema,
  village: z.string().trim().max(120).optional(),
  postal_code: postalCodeSchema,
  label: z.string().trim().max(40).optional(),
  is_default: z.boolean().optional(),
});

export const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Enter your current password.'),
  new_password: passwordSchema,
});

export const profileSchema = z.object({
  full_name: fullNameSchema,
  phone: phoneSchema,
});

export type FarmerRegisterValues = z.infer<typeof farmerRegisterSchema>;
export type CustomerRegisterValues = z.infer<typeof customerRegisterSchema>;
export type AddressValues = z.infer<typeof addressSchema>;
export type ProfileValues = z.infer<typeof profileSchema>;
