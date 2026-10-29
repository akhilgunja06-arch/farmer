import { z } from 'zod';

/**
 * Request schemas.
 *
 * These are the boundary where untrusted input becomes typed data. Zod strips
 * unknown keys, so a client cannot smuggle a `role`, `payment_status`,
 * `farmer_id` or `verification_status` into an INSERT by adding a field to the
 * JSON body — anything not named here is discarded before a handler sees it.
 */

export const languageSchema = z.enum(['en', 'te', 'hi']);

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^[0-9+\- ]{8,15}$/, 'Enter a valid phone number.');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.')
  .max(254);

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters long.')
  .max(128, 'Password must be 128 characters or fewer.');

export const idSchema = z.string().uuid('That identifier is not valid.');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

export const registerFarmerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  full_name: z.string().trim().min(2, 'Enter your full name.').max(120),
  phone: phoneSchema,
  preferred_language: languageSchema.default('en'),
  farm_name: z.string().trim().max(160).optional(),
  state: z.string().trim().min(2, 'Select your state.').max(80),
  district: z.string().trim().min(2, 'Select your district.').max(80),
  village: z.string().trim().min(1, 'Enter your village or town.').max(120),
  public_address: z.string().trim().max(500).optional(),
  latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  location_public: z.coerce.boolean().default(false),
  farming_type: z.array(z.string().trim().max(60)).max(10).default([]),
  crops_cultivated: z.array(z.string().trim().max(60)).max(30).default([]),
  bio: z.string().trim().max(1000).optional(),
  profile_photo: z.string().max(500).nullable().optional(),
  offers_delivery: z.coerce.boolean().default(false),
  offers_pickup: z.coerce.boolean().default(true),
  accepted_terms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the terms to continue.' }),
  }),
});

export const registerCustomerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  full_name: z.string().trim().min(2, 'Enter your full name.').max(120),
  phone: phoneSchema,
  preferred_language: languageSchema.default('en'),
  state: z.string().trim().min(2, 'Select your state.').max(80),
  district: z.string().trim().min(2, 'Select your district.').max(80),
  village: z.string().trim().max(120).optional(),
  delivery_address: z.string().trim().min(5, 'Enter your delivery address.').max(500),
  postal_code: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/, 'Enter a 6-digit PIN code.')
    .optional()
    .or(z.literal('')),
  profile_photo: z.string().max(500).nullable().optional(),
  accepted_terms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the terms to continue.' }),
  }),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
  // Optional, so a farmer who tries the customer form gets a useful error
  // instead of being silently signed in to the wrong area.
  expected_role: z.enum(['farmer', 'customer', 'admin']).optional(),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(10, 'That reset link is not valid.'),
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({ token: z.string().min(10) });

export const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Enter your current password.'),
  new_password: passwordSchema,
});

export const updateProfileSchema = z.object({
  full_name: z.string().trim().min(2).max(120).optional(),
  phone: phoneSchema.optional(),
  preferred_language: languageSchema.optional(),
  profile_photo: z.string().max(500).nullable().optional(),
});

export const unitSchema = z.enum([
  'kg', 'quintal', 'tonne', 'piece', 'bag', 'bunch', 'dozen', 'litre', 'other',
]);

// The base object is kept separate from the refined schema so that the partial
// update schema can be built from it. Nesting .refine() twice produces a
// ZodEffects that no longer exposes .partial().
const productBaseSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter the crop name.').max(160),
    category_id: z.coerce.number().int().positive().nullable().optional(),
    variety: z.string().trim().max(120).nullable().optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    price: z.coerce.number().positive('Enter a price greater than zero.').max(9_999_999),
    unit: unitSchema,
    custom_unit: z.string().trim().max(40).nullable().optional(),
    stock_quantity: z.coerce.number().min(0, 'Stock cannot be negative.').max(9_999_999),
    minimum_order_quantity: z.coerce.number().positive('Minimum order must be greater than zero.'),
    bulk_min_quantity: z.coerce.number().positive().nullable().optional(),
    bulk_price_per_unit: z.coerce.number().positive().nullable().optional(),
    price_negotiable: z.coerce.boolean().default(false),
    delivery_charge: z.coerce.number().min(0).max(1_000_000).default(0),
    harvest_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date format YYYY-MM-DD.')
      .nullable()
      .optional(),
    grade: z.enum(['A', 'B', 'C', 'ungraded']).default('ungraded'),
    moisture_content: z.coerce.number().min(0).max(100).nullable().optional(),
    visible_defects: z.string().trim().max(1000).nullable().optional(),
    size_appearance: z.string().trim().max(1000).nullable().optional(),
    storage_conditions: z.string().trim().max(1000).nullable().optional(),
    pesticide_info: z.string().trim().max(1000).nullable().optional(),
    organic_certified: z.coerce.boolean().default(false),
    organic_cert_number: z.string().trim().max(120).nullable().optional(),
    offers_delivery: z.coerce.boolean().default(true),
    offers_pickup: z.coerce.boolean().default(true),
    latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
    longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
    status: z.enum(['draft', 'active', 'out_of_stock', 'inactive']).default('draft'),
  });

export const productSchema = productBaseSchema
  .refine(
    (data) => data.unit !== 'other' || Boolean(data.custom_unit),
    { message: 'Name the unit you are using.', path: ['custom_unit'] },
  )
  .refine(
    (data) => !data.organic_certified || Boolean(data.organic_cert_number),
    {
      message: 'Enter the certification number, or turn off the organic claim.',
      path: ['organic_cert_number'],
    },
  )
  .refine(
    (data) =>
      (data.bulk_min_quantity === null || data.bulk_min_quantity === undefined) ===
      (data.bulk_price_per_unit === null || data.bulk_price_per_unit === undefined),
    { message: 'Enter both the bulk quantity and the bulk price, or neither.', path: ['bulk_price_per_unit'] },
  );

/**
 * Partial update. The same cross-field rules apply, but only to the fields the
 * caller actually sent — a form that omits the bulk tier must not be rejected
 * for "missing" it.
 */
export const productUpdateSchema = productBaseSchema
  .partial()
  .refine(
    (data) => !('unit' in data && data.unit === 'other') || Boolean(data.custom_unit),
    { message: 'Name the unit you are using.', path: ['custom_unit'] },
  )
  .refine(
    (data) => !data.organic_certified || Boolean(data.organic_cert_number),
    {
      message: 'Enter the certification number, or turn off the organic claim.',
      path: ['organic_cert_number'],
    },
  )
  .refine(
    (data) =>
      (data.bulk_min_quantity === null || data.bulk_min_quantity === undefined) ===
      (data.bulk_price_per_unit === null || data.bulk_price_per_unit === undefined),
    {
      message: 'Enter both the bulk quantity and the bulk price, or neither.',
      path: ['bulk_price_per_unit'],
    },
  );

export const productStatusSchema = z.object({
  status: z.enum(['draft', 'active', 'out_of_stock', 'inactive']),
});

export const productFiltersSchema = paginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  category: z.string().trim().max(60).optional(),
  variety: z.string().trim().max(120).optional(),
  farmer: z.string().trim().max(120).optional(),
  state: z.string().trim().max(80).optional(),
  district: z.string().trim().max(80).optional(),
  village: z.string().trim().max(120).optional(),
  min_price: z.coerce.number().min(0).optional(),
  max_price: z.coerce.number().min(0).optional(),
  grade: z.enum(['A', 'B', 'C', 'ungraded']).optional(),
  harvest_after: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  harvest_before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  min_quantity: z.coerce.number().min(0).optional(),
  offers_delivery: z.coerce.boolean().optional(),
  offers_pickup: z.coerce.boolean().optional(),
  verified_farmers_only: z.coerce.boolean().optional(),
  near_lat: z.coerce.number().min(-90).max(90).optional(),
  near_lng: z.coerce.number().min(-180).max(180).optional(),
  max_distance_km: z.coerce.number().min(1).max(2000).optional(),
  sort: z.enum(['recent', 'price_asc', 'price_desc', 'nearest', 'rating']).default('recent'),
});

export const cartAddSchema = z.object({
  product_id: idSchema,
  quantity: z.coerce.number().positive('Enter a quantity greater than zero.'),
});

export const cartUpdateSchema = z.object({
  quantity: z.coerce.number().min(0),
});

export const addressSchema = z.object({
  label: z.string().trim().max(60).optional(),
  recipient_name: z.string().trim().min(2, 'Enter the recipient name.').max(120),
  phone: phoneSchema,
  address_line: z.string().trim().min(5, 'Enter the delivery address.').max(500),
  state: z.string().trim().min(2, 'Select a state.').max(80),
  district: z.string().trim().min(2, 'Select a district.').max(80),
  village: z.string().trim().max(120).optional(),
  postal_code: z.string().trim().regex(/^[0-9]{6}$/, 'Enter a 6-digit PIN code.').optional().or(z.literal('')),
  latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  is_default: z.coerce.boolean().default(false),
});

export const checkoutSchema = z.object({
  fulfilment_method: z.enum(['delivery', 'pickup']),
  address_id: idSchema.nullable().optional(),
  customer_note: z.string().trim().max(500).nullable().optional(),
  // Generated by the client and reused across retries, so a double submit
  // produces one order rather than two.
  idempotency_key: z.string().trim().min(8).max(80).nullable().optional(),
});

export const orderStatusSchema = z.object({
  status: z.enum([
    'pending_confirmation', 'accepted', 'preparing', 'ready_for_pickup',
    'shipped', 'delivered', 'cancelled', 'refund_pending', 'refunded',
  ]),
  note: z.string().trim().max(500).nullable().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});

export const paymentInitiateSchema = z.object({
  order_id: idSchema,
  provider: z.enum(['razorpay', 'cod']),
});

export const paymentConfirmSchema = z.object({
  razorpay_order_id: z.string().min(4),
  razorpay_payment_id: z.string().min(4),
  razorpay_signature: z.string().min(8),
});

export const refundSchema = z.object({
  order_id: idSchema,
  amount: z.coerce.number().positive('Enter a refund amount greater than zero.'),
  reason: z.string().trim().min(3, 'Give a reason for the refund.').max(500),
});

export const reviewSchema = z.object({
  order_id: idSchema,
  product_id: idSchema.nullable().optional(),
  product_rating: z.coerce.number().int().min(1).max(5),
  seller_rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).nullable().optional(),
  photo_path: z.string().max(500).nullable().optional(),
});

export const conversationSchema = z.object({
  other_user_id: idSchema,
  product_id: idSchema.nullable().optional(),
  subject: z.string().trim().max(200).nullable().optional(),
  message: z.string().trim().max(4000).optional(),
});

export const messageSchema = z.object({
  body: z.string().trim().min(1, 'Enter a message.').max(4000),
  attachment_path: z.string().max(500).nullable().optional(),
});

export const qualityReportSchema = z.object({
  product_id: idSchema,
  title: z.string().trim().min(3, 'Give the report a title.').max(200),
  summary: z.string().trim().max(2000).nullable().optional(),
  measurements: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  report_document: z.string().max(500).nullable().optional(),
  inspection_provider: z.string().trim().max(200).nullable().optional(),
  inspection_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  inspector_name: z.string().trim().max(200).nullable().optional(),
  expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export const qualityIssueSchema = z.object({
  product_id: idSchema,
  reason: z.string().trim().min(3, 'Describe the problem.').max(200),
  details: z.string().trim().max(2000).nullable().optional(),
});

export const reportSchema = z.object({
  target_type: z.enum(['product', 'review', 'user', 'message']),
  target_id: idSchema,
  reason: z.string().trim().min(3, 'Give a reason.').max(200),
  details: z.string().trim().max(2000).nullable().optional(),
});

export const blockSchema = z.object({
  reason: z.string().trim().max(200).nullable().optional(),
});

export const marketObservationSchema = z.object({
  commodity: z.string().trim().min(2).max(120),
  variety: z.string().trim().max(120).nullable().optional(),
  state: z.string().trim().min(2).max(80),
  district: z.string().trim().max(80).nullable().optional(),
  market_name: z.string().trim().max(160).nullable().optional(),
  min_price: z.coerce.number().min(0).nullable().optional(),
  max_price: z.coerce.number().min(0).nullable().optional(),
  modal_price: z.coerce.number().min(0).nullable().optional(),
  unit: unitSchema.default('quintal'),
  source: z.enum(['agmarknet', 'enam', 'manual_entry']),
  source_ref: z.string().trim().max(200).nullable().optional(),
  observed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date format YYYY-MM-DD.'),
});

export const suspendUserSchema = z.object({
  suspended: z.coerce.boolean(),
  reason: z.string().trim().max(500).nullable().optional(),
});

export const setRoleSchema = z.object({
  role: z.enum(['farmer', 'customer', 'admin']),
});

export const verificationDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(1000).nullable().optional(),
});

export const qualityDecisionSchema = z.object({
  decision: z.enum(['verified', 'rejected']),
  note: z.string().trim().max(1000).nullable().optional(),
});

export const reportResolutionSchema = z.object({
  status: z.enum(['under_review', 'resolved', 'dismissed']),
  resolution: z.string().trim().max(1000).nullable().optional(),
});

export const productFlagSchema = z.object({
  flagged: z.coerce.boolean(),
});

export const categorySchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  slug: z.string().trim().min(2).max(60).regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and hyphens.'),
  name: z.string().trim().min(2).max(120),
  localized_names: z.record(z.string().max(120)).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  icon: z.string().trim().max(60).nullable().optional(),
  is_active: z.coerce.boolean().default(true),
  sort_order: z.coerce.number().int().min(0).max(9999).default(100),
});

export const appSettingSchema = z.object({
  key: z.string().trim().min(2).max(80),
  value: z.unknown(),
  description: z.string().trim().max(500).nullable().optional(),
});

export const farmerProfileUpdateSchema = z.object({
  farm_name: z.string().trim().max(160).nullable().optional(),
  state: z.string().trim().min(2).max(80).optional(),
  district: z.string().trim().min(2).max(80).optional(),
  village: z.string().trim().min(1).max(120).optional(),
  public_address: z.string().trim().max(500).nullable().optional(),
  latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  location_public: z.coerce.boolean().optional(),
  farming_type: z.array(z.string().trim().max(60)).max(10).optional(),
  crops_cultivated: z.array(z.string().trim().max(60)).max(30).optional(),
  bio: z.string().trim().max(1000).nullable().optional(),
  offers_delivery: z.coerce.boolean().optional(),
  offers_pickup: z.coerce.boolean().optional(),
});

export const verificationRequestSchema = z.object({
  farm_name: z.string().trim().max(160).nullable().optional(),
  id_document_path: z.string().max(500).nullable().optional(),
  land_document_path: z.string().max(500).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
