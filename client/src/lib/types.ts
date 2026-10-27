/**
 * Types mirroring the API responses.
 *
 * These are hand-written rather than generated. The API is small enough that
 * the clarity is worth it, and it keeps the client honest about the fact that
 * a field it reads must actually exist.
 */

export type Role = 'farmer' | 'customer' | 'admin';
export type Language = 'en' | 'te' | 'hi';

export type ProductStatus = 'draft' | 'active' | 'out_of_stock' | 'inactive';

export type ProductUnit =
  | 'kg'
  | 'quintal'
  | 'tonne'
  | 'piece'
  | 'bag'
  | 'bunch'
  | 'dozen'
  | 'litre'
  | 'other';

export type QualityGrade = 'A' | 'B' | 'C' | 'ungraded';

export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

export type OrderStatus =
  | 'pending_confirmation'
  | 'accepted'
  | 'preparing'
  | 'ready_for_pickup'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refund_pending'
  | 'refunded';

/**
 * The `payment_status` enum as the database defines it. Note this is the
 * order-level rollup, which is distinct from a payment row's own status.
 */
export type PaymentStatus =
  | 'unpaid'
  | 'created'
  | 'authorized'
  | 'captured'
  | 'failed'
  | 'refund_pending'
  | 'refunded'
  | 'cancelled';

export type FulfilmentMethod = 'delivery' | 'pickup';

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: Role;
  preferred_language: Language;
  profile_photo: string | null;
  email_verified: boolean;
  phone_verified: boolean;
  identity_verified: boolean;
  is_suspended: boolean;
  created_at: string;
}

export interface FarmerProfile {
  farm_name: string | null;
  state: string;
  district: string;
  village: string;
  public_address: string | null;
  latitude: number | null;
  longitude: number | null;
  location_public: boolean;
  farming_type: string | null;
  crops_cultivated: string[] | null;
  bio: string | null;
  offers_delivery: boolean;
  offers_pickup: boolean;
  verification_status: VerificationStatus;
  rating_avg: number | null;
  rating_count: number;
}

export interface Session {
  user: Profile;
  farmer_profile: FarmerProfile | null;
}

/** A product as it appears in a list, straight from `public_products`. */
export interface ProductSummary {
  id: string;
  farmer_id: string;
  name: string;
  /**
   * Only present on the owner view (`/api/products/mine`). The public catalogue
   * is filtered to active rows, so a status column never appears there.
   */
  status?: ProductStatus;
  category_id: number | null;
  category_slug: string | null;
  category_name: string | null;
  category_localized_names: Record<string, string> | null;
  variety: string | null;
  description: string | null;
  state: string;
  district: string;
  village: string;
  price: number;
  unit: ProductUnit;
  custom_unit: string | null;
  stock_quantity: number;
  minimum_order_quantity: number;
  bulk_min_quantity: number | null;
  bulk_price_per_unit: number | null;
  price_negotiable: boolean;
  delivery_charge: number;
  harvest_date: string | null;
  grade: QualityGrade;
  moisture_content: number | null;
  visible_defects: string | null;
  size_appearance: string | null;
  storage_conditions: string | null;
  pesticide_info: string | null;
  organic_certified: boolean;
  organic_cert_number: string | null;
  offers_delivery: boolean;
  offers_pickup: boolean;
  /** Null unless the farmer consented to showing a location. */
  latitude: number | null;
  longitude: number | null;
  rating_avg: number | null;
  rating_count: number;
  created_at: string;
  updated_at: string;
  farm_name: string | null;
  farmer_verification_status: VerificationStatus;
  farmer_rating_avg: number | null;
  farmer_rating_count: number;
  farmer_name: string;
  farmer_photo: string | null;
  primary_image: string | null;
  /** Only present when the request included a nearby location. */
  distance_km?: number | null;
}

export interface ProductImage {
  id: string;
  product_id: string;
  storage_path: string;
  caption: string | null;
  media_type: 'image' | 'video';
  sort_order: number;
}

/**
 * A quality report as the public sees it.
 *
 * `report_document` is null unless a reviewer verified the report — the view
 * withholds the attachment until then, so the UI cannot leak one by accident.
 */
export interface QualityReport {
  id: string;
  product_id: string;
  report_type: string;
  title: string | null;
  summary: string | null;
  measurements: Record<string, unknown> | null;
  ai_findings: Record<string, unknown> | null;
  ai_disclaimer: string | null;
  inspection_provider: string | null;
  inspection_date: string | null;
  inspector_name: string | null;
  verification_status: VerificationStatus;
  expiry_date: string | null;
  reviewed_at: string | null;
  report_document: string | null;
  created_at: string;
}

export interface ProductReview {
  id: string;
  product_id: string | null;
  farmer_id: string;
  product_rating: number;
  seller_rating: number;
  comment: string | null;
  photo_path: string | null;
  is_verified_purchase: boolean;
  reviewer_display_name: string;
  reviewer_photo: string | null;
  product_name: string | null;
  created_at: string;
}

/** The trimmed farmer record embedded in a product detail response. */
export interface ProductFarmer {
  user_id: string;
  full_name: string;
  profile_photo: string | null;
  farm_name: string | null;
  state: string;
  district: string;
  village: string;
  verification_status: VerificationStatus;
  rating_avg: number | null;
  rating_count: number;
  active_listings: number;
  offers_delivery: boolean;
  offers_pickup: boolean;
  bio: string | null;
  farming_type: string[] | null;
  crops_cultivated: string[] | null;
  created_at: string;
}

/**
 * The product detail payload.
 *
 * The API nests the related rows rather than flattening them, so this is a
 * different shape from `ProductSummary` even though it shares most fields.
 */
export interface ProductDetail extends ProductSummary {
  /**
   * Only present on the owner view. The public view is filtered to active rows
   * and therefore has no status column at all — which is the correct design,
   * since a draft should not exist as far as a visitor is concerned.
   */
  status?: ProductStatus;
  images: ProductImage[];
  qualityReports: QualityReport[];
  reviews: ProductReview[];
  similar: Array<Pick<ProductSummary, 'id' | 'name' | 'variety' | 'price' | 'unit' | 'state' | 'district' | 'primary_image' | 'rating_avg' | 'rating_count' | 'grade'>>;
  farmer: ProductFarmer | null;
}

/** The envelope every product detail response arrives in. */
export interface ProductDetailResponse {
  product: ProductDetail;
  is_owner: boolean;
}

/** A similar-product row, which the API returns with only these columns. */
export interface SimilarProduct {
  id: string;
  name: string;
  variety: string | null;
  price: number;
  unit: ProductUnit;
  state: string;
  district: string;
  primary_image: string | null;
  rating_avg: number | null;
  rating_count: number;
  grade: QualityGrade;
}

export interface CartLine {
  id: string;
  product_id: string;
  quantity: number;
  effective_unit_price: number;
  list_price: number;
  bulk_applied: boolean;
  line_subtotal: number;
  name: string;
  variety: string | null;
  unit: ProductUnit;
  custom_unit: string | null;
  stock_quantity: number;
  minimum_order_quantity: number;
  bulk_min_quantity: number | null;
  delivery_charge: number;
  product_status: ProductStatus;
  offers_delivery: boolean;
  offers_pickup: boolean;
  farmer_id: string;
  farmer_name: string;
  state: string | null;
  district: string | null;
  image: string | null;
  available: boolean;
  issue: string | null;
}

export interface CartGroup {
  farmer_id: string;
  farmer_name: string;
  state: string | null;
  district: string | null;
  lines: CartLine[];
  items_subtotal: number;
  delivery_charge: number;
  total_amount: number;
  offers_delivery: boolean;
  offers_pickup: boolean;
}

export interface Cart {
  id: string;
  lines: CartLine[];
  groups: CartGroup[];
  items_subtotal: number;
  delivery_charge: number;
  platform_fee: number;
  total_amount: number;
  item_count: number;
  has_issues: boolean;
}

export interface Address {
  id: string;
  recipient_name: string;
  phone: string;
  /** The API field is `address_line`; it is the street address. */
  address_line: string;
  state: string;
  district: string;
  village: string | null;
  postal_code: string | null;
  is_default: boolean;
  label: string | null;
}

export interface OrderItem {
  id: string;
  product_id: string;
  product_name_snapshot: string;
  unit_snapshot: string;
  quantity: number;
  unit_price_snapshot: number;
  subtotal: number;
}

export interface Order {
  id: string;
  order_number: string;
  customer_id: string;
  farmer_id: string;
  customer_name: string;
  farmer_name: string;
  items_subtotal: number;
  delivery_charge: number;
  platform_fee: number;
  total_amount: number;
  order_status: OrderStatus;
  payment_status: PaymentStatus;
  fulfilment_method: FulfilmentMethod;
  delivery_address_snapshot: Record<string, unknown> | null;
  customer_note: string | null;
  farmer_note: string | null;
  items: OrderItem[];
  payments: Payment[];
  created_at: string;
  accepted_at: string | null;
  delivered_at: string | null;
}

export interface Payment {
  id: string;
  provider: string;
  provider_payment_reference: string | null;
  amount: number;
  status: PaymentStatus;
  created_at: string;
}

export interface Conversation {
  id: string;
  subject: string | null;
  product_id: string | null;
  product_name: string | null;
  other_user_id: string;
  other_user_name: string;
  other_user_photo: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
  /** True when the counterpart has blocked the current user, which stops sends. */
  is_blocked: boolean;
  /** True when the current user has blocked the counterpart. */
  blocked_by_me: boolean;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string;
  body: string;
  attachment_path: string | null;
  read_at: string | null;
  created_at: string;
  is_mine: boolean;
}

/** A review row from `public_reviews`, plus its own review list envelope. */
export interface Review extends ProductReview {
  is_hidden?: boolean;
  customer_id?: string;
  order_id?: string;
}

export interface Category {
  id: number;
  name: string;
  localized_names: Record<string, string> | null;
  description: string | null;
  icon: string | null;
  product_count?: number;
}

export interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  metadata: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/** A farmer as shown in the directory, from `public_farmer_profiles`. */
export interface FarmerSummary {
  user_id: string;
  full_name: string;
  profile_photo: string | null;
  farm_name: string | null;
  state: string;
  district: string;
  village: string;
  public_address: string | null;
  /** Null unless the farmer consented to publishing a location. */
  latitude: number | null;
  longitude: number | null;
  farming_type: string[] | null;
  crops_cultivated: string[] | null;
  bio: string | null;
  offers_delivery: boolean;
  offers_pickup: boolean;
  verification_status: VerificationStatus;
  verification_note: string | null;
  verified_at: string | null;
  rating_avg: number | null;
  rating_count: number;
  active_listings: number;
  created_at: string;
  /** Only present when the request included a nearby location. */
  distance_km?: number | null;
}

export interface MarketObservation {
  id: string;
  commodity: string;
  state: string;
  district: string | null;
  market_name: string | null;
  min_price: number | null;
  max_price: number | null;
  modal_price: number | null;
  unit: string;
  observed_on: string;
  source: string;
  source_url: string | null;
  age_days: number;
  freshness: 'current' | 'recent' | 'stale';
}

export interface MarketComparison {
  commodity: string;
  state: string;
  unit: string;
  observations: MarketObservation[];
  marketplace: {
    listing_count: number;
    min_price: number | null;
    max_price: number | null;
    average_price: number | null;
    label: string;
  };
  data_source_configured: boolean;
  disclosure: string;
}

export interface AdminOverview {
  farmers: number;
  customers: number;
  active_listings: number;
  draft_listings: number;
  total_orders: number;
  orders_last_30_days: number;
  gross_merchandise_value: number;
  platform_fees_collected: number;
  pending_verifications: number;
  open_reports: number;
  suspended_accounts: number;
  integrations: Record<string, boolean>;
}

export interface AuditLog {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}
