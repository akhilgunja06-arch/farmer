import type { ProductUnit, QualityGrade, OrderStatus, PaymentStatus } from './types';

/**
 * Formatting helpers.
 *
 * Money always uses `en-IN`, in every interface language. Indian users read
 * 1,00,000 as one lakh regardless of whether the page is in Telugu, and
 * switching to a Latin-locale grouping would be actively confusing.
 */

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatINR(value: number | string | null | undefined): string {
  const amount = typeof value === 'string' ? Number(value) : value;
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  return INR.format(amount);
}

/** Quantities: trim trailing zeros so 10.000 reads as 10. */
export function formatQuantity(value: number | string | null | undefined): string {
  const quantity = typeof value === 'string' ? Number(value) : value;
  if (quantity === null || quantity === undefined || Number.isNaN(quantity)) return '—';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(quantity);
}

const DATE_SHORT = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const DATE_TIME = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : DATE_SHORT.format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : DATE_TIME.format(date);
}

/** "3 hours ago" — used in message lists and notifications. */
export function formatRelative(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`;

  return formatDate(value);
}

/** The short form shown next to a price, e.g. "kg" or the farmer's own unit. */
export function unitLabel(unit: ProductUnit, customUnit: string | null): string {
  if (unit === 'other') return customUnit || 'unit';
  const short: Record<ProductUnit, string> = {
    kg: 'kg',
    quintal: 'qtl',
    tonne: 't',
    piece: 'pc',
    bag: 'bag',
    bunch: 'bunches',
  dozen: 'dozen',
  litre: 'litre',
  other: 'unit',
  };
  return short[unit];
}

/** The i18n key for a unit's full name, for form labels and detail pages. */
export function unitNameKey(unit: ProductUnit): string {
  return `units.${unit}`;
}

export function gradeLabelKey(grade: QualityGrade): string {
  const map: Record<QualityGrade, string> = {
    A: 'product.gradeA',
    B: 'product.gradeB',
    C: 'product.gradeC',
    ungraded: 'product.gradeUngraded',
  };
  return map[grade] ?? 'product.gradeUngraded';
}

/** Camel-cased i18n key for an order status, e.g. `order.statusAccepted`. */
export function orderStatusKey(status: OrderStatus): string {
  const map: Record<OrderStatus, string> = {
    pending_confirmation: 'order.statusPendingConfirmation',
    accepted: 'order.statusAccepted',
    preparing: 'order.statusPreparing',
    ready_for_pickup: 'order.statusReadyForPickup',
    shipped: 'order.statusShipped',
    delivered: 'order.statusDelivered',
    cancelled: 'order.statusCancelled',
    refund_pending: 'order.statusRefundPending',
    refunded: 'order.statusRefunded',
  };
  return map[status] ?? 'common.unknown';
}

export function paymentStatusKey(status: PaymentStatus): string {
  const map: Record<PaymentStatus, string> = {
    unpaid: 'order.paymentUnpaid',
    created: 'order.paymentCreated',
    authorized: 'order.paymentAuthorized',
    captured: 'order.paymentPaid',
    failed: 'order.paymentFailed',
    refund_pending: 'order.statusRefundPending',
    refunded: 'order.paymentRefunded',
    cancelled: 'order.paymentCancelled',
  };
  return map[status] ?? 'common.unknown';
}

/**
 * Colour tone per order status, used by the badge component. Kept here so the
 * mapping lives in one place rather than in every screen that shows a status.
 */
export function orderStatusTone(
  status: OrderStatus,
): 'neutral' | 'info' | 'warning' | 'success' | 'danger' {
  switch (status) {
    case 'pending_confirmation':
      return 'warning';
    case 'accepted':
    case 'preparing':
    case 'ready_for_pickup':
    case 'shipped':
      return 'info';
    case 'delivered':
      return 'success';
    case 'cancelled':
      return 'danger';
    case 'refund_pending':
      return 'warning';
    case 'refunded':
      return 'neutral';
    default:
      return 'neutral';
  }
}

/** Percent of stock remaining, for the low-stock indicator. */
export function stockTone(quantity: number): 'ok' | 'low' | 'out' {
  if (quantity <= 0) return 'out';
  if (quantity <= 10) return 'low';
  return 'ok';
}
