import { api } from './api';
import type {
  Address,
  AdminOverview,
  AuditLog,
  Cart,
  Category,
  Conversation,
  FarmerSummary,
  MarketComparison,
  MarketObservation,
  Message,
  Notification,
  Order,
  Paginated,
  ProductDetailResponse,
  ProductSummary,
  QualityReport,
  Review,
  Session,
} from './types';

/**
 * Typed wrappers over the API.
 *
 * Every page goes through here rather than calling `api.get` directly, so the
 * request shape for an endpoint is written once. It also makes it obvious which
 * endpoints the frontend actually uses.
 */

type Params = Record<string, string | number | boolean | undefined | null>;

// ---------------------------------------------------------------- products

export interface ProductFilters extends Params {
  search?: string;
  category?: string;
  variety?: string;
  farmer?: string;
  state?: string;
  district?: string;
  village?: string;
  min_price?: number;
  max_price?: number;
  grade?: string;
  harvest_after?: string;
  harvest_before?: string;
  min_quantity?: number;
  offers_delivery?: boolean;
  offers_pickup?: boolean;
  verified_farmers_only?: boolean;
  near_lat?: number;
  near_lng?: number;
  max_distance_km?: number;
  sort?: string;
  page?: number;
  page_size?: number;
}

export const products = {
  list: (filters: ProductFilters, signal?: AbortSignal) =>
    api.get<Paginated<ProductSummary>>('/api/products', filters, signal),

  detail: (id: string, signal?: AbortSignal) =>
    api.get<ProductDetailResponse>(`/api/products/${id}`, undefined, signal),

  mine: (options: { status?: string; search?: string; page?: number } = {}, signal?: AbortSignal) =>
    api.get<Paginated<ProductSummary>>('/api/products/mine', options, signal),

  categories: (signal?: AbortSignal) =>
    api.get<{ categories: Category[] }>('/api/products/categories', undefined, signal),

  states: (signal?: AbortSignal) =>
    api.get<{ states: string[] }>('/api/products/locations/states', undefined, signal),

  districts: (state: string, signal?: AbortSignal) =>
    api.get<{ districts: string[] }>(
      '/api/products/locations/districts',
      { state },
      signal,
    ),

  create: (payload: Record<string, unknown>) => api.post<{ id: string }>('/api/products', payload),

  update: (id: string, payload: Record<string, unknown>) =>
    api.patch<ProductSummary>(`/api/products/${id}`, payload),

  setStatus: (id: string, status: string) =>
    api.put<{ id: string; status: string }>(`/api/products/${id}/status`, { status }),

  remove: (id: string) => api.delete<void>(`/api/products/${id}`),

  uploadImage: (id: string, file: File, caption?: string) => {
    const form = new FormData();
    form.append('image', file);
    if (caption) form.append('caption', caption);
    return api.upload<{ id: string; storage_path: string }>(`/api/products/${id}/images`, form);
  },

  deleteImage: (productId: string, imageId: string) =>
    api.delete<void>(`/api/products/${productId}/images/${imageId}`),

  qualityReports: (id: string, signal?: AbortSignal) =>
    api.get<{ reports: QualityReport[] }>(`/api/products/${id}/quality-reports`, undefined, signal),

  addQualityReport: (id: string, payload: Record<string, unknown>) =>
    api.post<{ id: string }>(`/api/products/${id}/quality-reports`, payload),
};

// ---------------------------------------------------------------- farmers

export const farmers = {
  list: (params: Params = {}, signal?: AbortSignal) =>
    api.get<Paginated<FarmerSummary>>('/api/farmers', params, signal),

  detail: (id: string, signal?: AbortSignal) =>
    api.get<{ farmer: FarmerSummary; products: ProductSummary[] }>(
      `/api/farmers/${id}`,
      undefined,
      signal,
    ),

  nearby: (params: { near_lat?: number; near_lng?: number; max_distance_km?: number; crop?: string } = {}, signal?: AbortSignal) =>
    api.get<{ farmers: FarmerSummary[] }>('/api/farmers/nearby-farmers', params, signal),

  profile: (signal?: AbortSignal) =>
    api.get<{ profile: Record<string, unknown> }>('/api/farmer/profile', undefined, signal),

  updateProfile: (payload: Record<string, unknown>) =>
    api.patch<{ profile: Record<string, unknown> }>('/api/farmer/profile', payload),

  requestVerification: (payload: Record<string, unknown>) =>
    api.post<{ id: string }>('/api/farmer/profile/verification-request', payload),
};

// ---------------------------------------------------------------- cart

export const cart = {
  get: (signal?: AbortSignal) => api.get<{ cart: Cart }>('/api/cart', undefined, signal),

  count: () => api.get<{ count: number }>('/api/cart/count'),

  add: (productId: string, quantity: number) =>
    api.post<{ cart: Cart }>('/api/cart/items', { product_id: productId, quantity }),

  updateItem: (itemId: string, quantity: number) =>
    api.patch<{ cart: Cart }>(`/api/cart/items/${itemId}`, { quantity }),

  removeItem: (itemId: string) => api.delete<{ cart: Cart }>(`/api/cart/items/${itemId}`),

  clear: () => api.delete<{ cart: Cart }>('/api/cart'),
};

export const saved = {
  list: (signal?: AbortSignal) =>
    api.get<{ items: ProductSummary[] }>('/api/saved', undefined, signal),
  add: (productId: string) => api.post<{ saved: boolean }>(`/api/saved/${productId}`),
  remove: (productId: string) => api.delete<{ saved: boolean }>(`/api/saved/${productId}`),
};

export const addresses = {
  list: (signal?: AbortSignal) => api.get<{ addresses: Address[] }>('/api/addresses', undefined, signal),
  create: (payload: Record<string, unknown>) => api.post<{ id: string }>('/api/addresses', payload),
  update: (id: string, payload: Record<string, unknown>) =>
    api.patch<{ id: string }>(`/api/addresses/${id}`, payload),
  remove: (id: string) => api.delete<void>(`/api/addresses/${id}`),
  setDefault: (id: string) => api.post<{ id: string }>(`/api/addresses/${id}/default`),
};

// ---------------------------------------------------------------- orders

export const orders = {
  list: (params: Params = {}, signal?: AbortSignal) =>
    api.get<Paginated<Order>>('/api/orders', params, signal),

  /**
   * One order.
   *
   * The endpoint wraps the row in `{ order }`; unwrapping here keeps the rest of
   * the app working with an `Order` rather than an envelope.
   */
  detail: (id: string, signal?: AbortSignal) =>
    api
      .get<{ order: Order }>(`/api/orders/${id}`, undefined, signal)
      .then((response) => response.order),

  stats: (signal?: AbortSignal) =>
    api.get<{ stats: Record<string, number> }>('/api/orders/stats', undefined, signal),

  checkout: (payload: {
    delivery_address_id?: string;
    fulfilment_method: 'delivery' | 'pickup';
    customer_note?: string;
    idempotency_key?: string;
  }) => api.post<{ orders: Order[]; total_amount: number; message: string }>('/api/orders/checkout', payload),

  setStatus: (id: string, status: string, note?: string) =>
    api.put<{ order_status: string }>(`/api/orders/${id}/status`, { status, note }),
};

export const payments = {
  /**
   * What this deployment can actually accept.
   *
   * `configured` is false when no gateway credentials are present. The UI must
   * treat that as "online payment unavailable" and offer pay-on-delivery, never
   * as a success state.
   */
  capability: (signal?: AbortSignal) =>
    api.get<{
      configured: boolean;
      provider: string | null;
      webhookConfigured: boolean;
      publicKeyId: string | null;
      reason: string;
    }>('/api/payments/capability', undefined, signal),

  initiate: (orderId: string, provider: 'razorpay' | 'cod') =>
    api.post<Record<string, unknown>>('/api/payments/initiate', {
      order_id: orderId,
      provider,
    }),

  confirm: (payload: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  }) => api.post<{ status: string }>('/api/payments/confirm', payload),
};

// ---------------------------------------------------------------- messaging

export const messages = {
  conversations: (signal?: AbortSignal) =>
    api.get<Paginated<Conversation>>('/api/messages', undefined, signal),

  unreadCount: (signal?: AbortSignal) =>
    api.get<{ count: number }>('/api/messages/unread-count', undefined, signal),

  open: (payload: { other_user_id: string; product_id?: string | null; message?: string }) =>
    api.post<{ conversation: Conversation }>('/api/messages', payload),

  thread: (id: string, signal?: AbortSignal) =>
    api.get<{ conversation: Conversation; messages: Message[] }>(
      `/api/messages/${id}`,
      undefined,
      signal,
    ),

  send: (id: string, body: string) =>
    api.post<{ message: Message }>(`/api/messages/${id}/messages`, { body }),

  markRead: (id: string) => api.post<{ ok: boolean }>(`/api/messages/${id}/read`),

  block: (id: string, reason?: string) =>
    api.post<{ message: string }>(`/api/messages/${id}/block`, { reason: reason ?? null }),

  unblock: (id: string) => api.delete<{ message: string }>(`/api/messages/${id}/block`),
};

// ---------------------------------------------------------------- reviews

export const reviews = {
  forProduct: (productId: string, signal?: AbortSignal) =>
    api.get<{ reviews: Review[]; summary: { average: number | null; count: number } }>(
      `/api/reviews/product/${productId}`,
      undefined,
      signal,
    ),

  forFarmer: (farmerId: string, signal?: AbortSignal) =>
    api.get<{ reviews: Review[] }>(`/api/reviews/farmer/${farmerId}`, undefined, signal),

  pending: (signal?: AbortSignal) =>
    api.get<{ pending: Array<Record<string, unknown>> }>('/api/reviews/pending', undefined, signal),

  mine: (signal?: AbortSignal) =>
    api.get<{ reviews: Review[] }>('/api/reviews/mine', undefined, signal),

  create: (payload: {
    order_id: string;
    product_id?: string | null;
    product_rating: number;
    seller_rating: number;
    comment?: string;
  }) => api.post<{ id: string }>('/api/reviews', payload),

  report: (id: string, reason: string, details?: string) =>
    api.post<{ id: string }>(`/api/reviews/${id}/report`, { reason, details }),

  uploadPhoto: (id: string, file: File) => {
    const form = new FormData();
    form.append('photo', file);
    return api.upload<{ path: string }>(`/api/reviews/${id}/photo`, form);
  },
};

// ---------------------------------------------------------------- quality

export const quality = {
  standards: (signal?: AbortSignal) =>
    api.get<Record<string, unknown>>('/api/quality/standards', undefined, signal),

  aiStatus: (signal?: AbortSignal) =>
    api.get<{ enabled: boolean; disclaimer: string }>('/api/quality/ai-assess', undefined, signal),

  /**
   * Ask for a preliminary visual assessment of a photograph on a listing.
   *
   * The server needs to know which listing the image belongs to, so the product
   * id travels with the file.
   */
  aiAssess: (productId: string, file: File) => {
    const form = new FormData();
    form.append('product_id', productId);
    form.append('image', file);
    return api.upload<{
      assessment: Record<string, unknown>;
      disclaimer: string;
    }>('/api/quality/ai-assess', form);
  },

  reportIssue: (payload: Record<string, unknown>) =>
    api.post<{ id: string }>('/api/quality/issues', payload),

  myIssues: (signal?: AbortSignal) =>
    api.get<{ issues: Array<Record<string, unknown>> }>('/api/quality/issues/mine', undefined, signal),
};

// ---------------------------------------------------------------- reports

export const reports = {
  /**
   * File a report against a product, review, user or message.
   *
   * The server stores it in `user_reports` for the moderation queue; it does
   * not act on it automatically.
   */
  create: (payload: {
    target_type: 'product' | 'review' | 'user' | 'message';
    target_id: string;
    reason: string;
    details?: string | null;
  }) => api.post<{ id: string; message: string }>('/api/reports', payload),
};

// ---------------------------------------------------------------- market

export const market = {
  compare: (params: { commodity: string; state: string; district?: string }, signal?: AbortSignal) =>
    api.get<MarketComparison>('/api/market/compare', params, signal),

  history: (params: { commodity: string; state?: string; days?: number }, signal?: AbortSignal) =>
    api.get<{ observations: MarketObservation[] }>('/api/market/history', params, signal),

  commodities: (signal?: AbortSignal) =>
    api.get<{
      commodities: Array<{
        commodity: string;
        state: string;
        latest_observation: string | null;
        observation_count: number;
      }>;
    }>('/api/market/commodities', undefined, signal),

  addObservation: (payload: Record<string, unknown>) =>
    api.post<{ id: string }>('/api/market/observations', payload),

  integrationStatus: (signal?: AbortSignal) =>
    api.get<{ configured: boolean; message: string }>(
      '/api/market/integration-status',
      undefined,
      signal,
    ),
};

// ---------------------------------------------------------------- notifications

export const notifications = {
  list: (signal?: AbortSignal) =>
    api.get<Paginated<Notification>>('/api/notifications', undefined, signal),
  unreadCount: (signal?: AbortSignal) =>
    api.get<{ count: number }>('/api/notifications/unread-count', undefined, signal),
  markRead: (id: string) => api.post<{ ok: boolean }>(`/api/notifications/${id}/read`),
  markAllRead: () => api.post<{ ok: boolean }>('/api/notifications/read-all'),
};

// ---------------------------------------------------------------- admin

export const admin = {
  overview: (signal?: AbortSignal) =>
    api.get<AdminOverview>('/api/admin/overview', undefined, signal),

  analytics: (signal?: AbortSignal) =>
    api.get<Record<string, unknown>>('/api/admin/analytics', undefined, signal),

  users: (params: Params = {}, signal?: AbortSignal) =>
    api.get<Paginated<Record<string, unknown>>>('/api/admin/users', params, signal),

  user: (id: string, signal?: AbortSignal) =>
    api.get<Record<string, unknown>>(`/api/admin/users/${id}`, undefined, signal),

  setSuspension: (id: string, suspended: boolean, reason?: string) =>
    api.put<{ ok: boolean }>(`/api/admin/users/${id}/suspension`, { suspended, reason }),

  setRole: (id: string, role: string) =>
    api.put<{ ok: boolean }>(`/api/admin/users/${id}/role`, { role }),

  products: (params: Params = {}, signal?: AbortSignal) =>
    api.get<Paginated<ProductSummary>>('/api/admin/products', params, signal),

  flagProduct: (id: string, payload: { flagged: boolean; reason?: string }) =>
    api.put<{ ok: boolean }>(`/api/admin/products/${id}/flag`, payload),

  orders: (params: Params = {}, signal?: AbortSignal) =>
    api.get<Paginated<Order>>('/api/admin/orders', params, signal),

  verificationRequests: (params: Params = {}, signal?: AbortSignal) =>
    api.get<Paginated<Record<string, unknown>>>('/api/admin/verification-requests', params, signal),

  reviewVerification: (id: string, payload: { status: string; note?: string }) =>
    api.put<{ ok: boolean }>(`/api/admin/verification-requests/${id}`, payload),

  qualityReports: (params: Params = {}, signal?: AbortSignal) =>
    api.get<Paginated<Record<string, unknown>>>('/api/admin/quality-reports', params, signal),

  reviewQualityReport: (id: string, payload: { status: string; note?: string }) =>
    api.put<{ ok: boolean }>(`/api/admin/quality-reports/${id}`, payload),

  reports: (params: Params = {}, signal?: AbortSignal) =>
    api.get<Paginated<Record<string, unknown>>>('/api/admin/reports', params, signal),

  reviewReport: (id: string, payload: { status: string; note?: string }) =>
    api.put<{ ok: boolean }>(`/api/admin/reports/${id}`, payload),

  moderateReview: (id: string, hidden: boolean, reason?: string) =>
    api.put<{ ok: boolean }>(`/api/admin/reviews/${id}/moderation`, { hidden, reason }),

  categories: (signal?: AbortSignal) =>
    api.get<{ categories: Category[] }>('/api/admin/categories', undefined, signal),

  saveCategory: (payload: Record<string, unknown>) =>
    api.put<{ id: string }>('/api/admin/categories', payload),

  settings: (signal?: AbortSignal) =>
    api.get<{ settings: Record<string, unknown>; integrations: Record<string, boolean> }>(
      '/api/admin/settings',
      undefined,
      signal,
    ),

  saveSettings: (payload: Record<string, unknown>) =>
    api.put<{ ok: boolean }>('/api/admin/settings', payload),

  auditLogs: (params: Params = {}, signal?: AbortSignal) =>
    api.get<Paginated<AuditLog>>('/api/admin/audit-logs', params, signal),
};

export const auth = {
  session: (signal?: AbortSignal) => api.get<Session>('/api/auth/me', undefined, signal),
  updateProfile: (payload: Record<string, unknown>) =>
    api.patch<{ user: Record<string, unknown> }>('/api/auth/profile', payload),
  changePassword: (payload: { current_password: string; new_password: string }) =>
    api.post<{ ok: boolean }>('/api/auth/change-password', payload),
  forgotPassword: (email: string) => api.post<{ message: string }>('/api/auth/forgot-password', { email }),
  resetPassword: (payload: { token: string; new_password: string }) =>
    api.post<{ ok: boolean }>('/api/auth/reset-password', payload),
  verifyEmail: (token: string) => api.post<{ ok: boolean }>('/api/auth/verify-email', { token }),
  resendVerification: (email: string) =>
    api.post<{ message: string }>('/api/auth/resend-verification', { email }),
  consents: (signal?: AbortSignal) =>
    api.get<{ consents: Array<Record<string, unknown>> }>('/api/auth/consents', undefined, signal),
};

/** The dashboard summary for a farmer. */
export const farmerDashboard = {
  summary: (signal?: AbortSignal) =>
    api.get<Record<string, unknown>>('/api/dashboard/farmer', undefined, signal),
  customer: (signal?: AbortSignal) =>
    api.get<Record<string, unknown>>('/api/dashboard/customer', undefined, signal),
};
