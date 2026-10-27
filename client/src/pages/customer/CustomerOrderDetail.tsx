import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, MapPin, Star, Truck } from 'lucide-react';
import { RoleShell } from '@/components/layout/RoleShell';
import { useAsync } from '@/hooks/useCart';
import { orders as ordersApi, reviews as reviewsApi } from '@/lib/services';
import { ApiError, messageOf } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, ErrorState, Notice, Spinner } from '@/components/ui/Card';
import { StatusBadge, VerifiedPurchaseBadge } from '@/components/ui/Badge';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { TextArea } from '@/components/ui/Field';
import { RatingInput } from '@/components/ui/Rating';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  formatDateTime,
  formatINR,
  formatQuantity,
  orderStatusKey,
  orderStatusTone,
  paymentStatusKey,
} from '@/lib/format';
import type { OrderStatus, PaymentStatus } from '@/lib/types';

interface OrderDetail extends Record<string, unknown> {
  id: string;
  order_number: string;
  order_status: OrderStatus;
  payment_status: string;
  fulfilment_method: string;
  items_subtotal: number;
  delivery_charge: number;
  platform_fee: number;
  total_amount: number;
  customer_note: string | null;
  farmer_note: string | null;
  created_at: string;
  items: Array<{
    id: string;
    product_id: string;
    product_name_snapshot: string;
    unit_snapshot: string;
    quantity: number;
    unit_price_snapshot: number;
    subtotal: number;
    product_image: string | null;
  }>;
  payments: Array<{ id: string; provider: string; amount: number; status: string }>;
  review: { id: string; product_rating: number; seller_rating: number; comment: string | null } | null;
}

/**
 * One order, from the customer's side.
 *
 * A review can only be written once the order is delivered, and only once. The
 * server enforces both — the button here just reflects the same rule so a
 * customer is not offered an action that would be rejected.
 */
export default function CustomerOrderDetail() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const result = useAsync((signal) => ordersApi.detail(id, signal), [id]);
  const order = result.data as OrderDetail | null;
  useDocumentTitle(order ? order.order_number : t('farmer.orderNumber'));

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [productRating, setProductRating] = useState(5);
  const [sellerRating, setSellerRating] = useState(5);
  const [comment, setComment] = useState('');
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewDone, setReviewDone] = useState(false);

  const cancelOrder = async () => {
    setBusy(true);
    setError(null);
    try {
      await ordersApi.setStatus(id, 'cancelled');
      setConfirmCancel(false);
      result.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const submitReview = async () => {
    setBusy(true);
    setReviewError(null);
    try {
      await reviewsApi.create({
        order_id: id,
        product_id: order?.items[0]?.product_id ?? null,
        product_rating: productRating,
        seller_rating: sellerRating,
        ...(comment ? { comment } : {}),
      });
      setReviewOpen(false);
      setReviewDone(true);
      result.reload();
    } catch (caught) {
      setReviewError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  if (result.loading) {
    return (
      <RoleShell role="customer" title={t('farmer.orderNumber')}>
        <Spinner />
      </RoleShell>
    );
  }

  if (result.error || !order) {
    return (
      <RoleShell role="customer" title={t('farmer.orderNumber')}>
        <ErrorState message={result.error ?? t('common.notFound')} onRetry={result.reload} />
      </RoleShell>
    );
  }

  const canCancel = ['pending_confirmation', 'accepted', 'preparing'].includes(order.order_status);
  const canReview = order.order_status === 'delivered' && !order.review;

  return (
    <RoleShell role="customer" title={order.order_number}>
      <div className="space-y-5">
        <Button variant="ghost" size="sm" onClick={() => navigate('/customer/orders')}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t('nav.myOrders')}
        </Button>

        {error && <Notice tone="danger">{error}</Notice>}
        {reviewDone && <Notice tone="success">{t('customer.reviewSubmitted')}</Notice>}

        <Card>
          <CardBody className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-lg font-bold text-soil-900">{order.order_number}</h1>
              <p className="text-sm text-soil-600">{formatDateTime(order.created_at)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={orderStatusTone(order.order_status)}>
                {t(orderStatusKey(order.order_status))}
              </StatusBadge>
              <StatusBadge tone="neutral">{t(paymentStatusKey(order.payment_status as PaymentStatus))}</StatusBadge>
            </div>
          </CardBody>
        </Card>

        <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-5">
            <Card>
              <CardHeader title={t('customer.priceBreakdown')} />
              <CardBody className="space-y-3">
                <ul className="space-y-2">
                  {order.items.map((item) => (
                    <li key={item.id} className="flex justify-between gap-3 text-sm">
                      <span className="text-soil-800">
                        {item.product_name_snapshot} × {formatQuantity(item.quantity)}{' '}
                        {item.unit_snapshot}
                        <span className="block text-xs text-soil-500">
                          {formatINR(item.unit_price_snapshot)} {t('product.perUnit', { unit: item.unit_snapshot })}
                        </span>
                      </span>
                      <span className="tabular font-medium">{formatINR(item.subtotal)}</span>
                    </li>
                  ))}
                </ul>

                <dl className="space-y-1.5 border-t border-soil-100 pt-3 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-soil-600">{t('customer.itemsSubtotal')}</dt>
                    <dd className="tabular">{formatINR(order.items_subtotal)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-soil-600">{t('customer.deliveryCharge')}</dt>
                    <dd className="tabular">{formatINR(order.delivery_charge)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-soil-600">{t('customer.platformFee')}</dt>
                    <dd className="tabular">{formatINR(order.platform_fee)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-soil-200 pt-1.5">
                    <dt className="font-bold text-soil-900">{t('customer.total')}</dt>
                    <dd className="tabular text-lg font-bold">{formatINR(order.total_amount)}</dd>
                  </div>
                </dl>
              </CardBody>
            </Card>

            {order.payments.length > 0 && (
              <Card>
                <CardHeader title={t('customer.paymentMethod')} />
                <CardBody className="space-y-2">
                  {order.payments.map((payment) => (
                    <div key={payment.id} className="flex items-center justify-between text-sm">
                      <span className="text-soil-700">{payment.provider}</span>
                      <span className="flex items-center gap-2">
                        <span className="tabular">{formatINR(payment.amount)}</span>
                        <StatusBadge tone="neutral">{t(paymentStatusKey(payment.status as PaymentStatus))}</StatusBadge>
                      </span>
                    </div>
                  ))}
                </CardBody>
              </Card>
            )}

            {order.review && (
              <Card>
                <CardHeader
                  title={t('customer.writeReview')}
                  action={<VerifiedPurchaseBadge />}
                />
                <CardBody className="space-y-2 text-sm">
                  <p className="flex items-center gap-2">
                    <Star className="size-4 text-sun-500" aria-hidden="true" />
                    {t('customer.reviewProduct')}: {order.review.product_rating}/5 ·{' '}
                    {t('customer.reviewSeller')}: {order.review.seller_rating}/5
                  </p>
                  {order.review.comment && <p className="text-soil-700">{order.review.comment}</p>}
                </CardBody>
              </Card>
            )}
          </div>

          <aside className="space-y-4">
            <Card>
              <CardBody className="space-y-3">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-soil-800">
                  {order.fulfilment_method === 'pickup' ? (
                    <>
                      <MapPin className="size-4" aria-hidden="true" />
                      {t('customer.pickup')}
                    </>
                  ) : (
                    <>
                      <Truck className="size-4" aria-hidden="true" />
                      {t('customer.delivery')}
                    </>
                  )}
                </p>

                {order.customer_note && (
                  <p className="text-xs text-soil-600">
                    {t('customer.orderNote')}: {order.customer_note}
                  </p>
                )}
                {order.farmer_note && (
                  <Notice tone="info" title={t('admin.reviewNote')}>
                    {order.farmer_note}
                  </Notice>
                )}

                {canReview && (
                  <Button block onClick={() => setReviewOpen(true)}>
                    <Star className="size-4" aria-hidden="true" />
                    {t('customer.writeReview')}
                  </Button>
                )}

                {canCancel && (
                  <Button variant="outline" block onClick={() => setConfirmCancel(true)}>
                    {t('order.cancelOrder')}
                  </Button>
                )}
              </CardBody>
            </Card>
          </aside>
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => void cancelOrder()}
        title={t('order.cancelConfirm')}
        description={t('order.cancelReason')}
        confirmLabel={t('order.cancelOrder')}
        loading={busy}
      />

      <Modal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title={t('customer.writeReview')}
        footer={
          <>
            <Button variant="outline" onClick={() => setReviewOpen(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void submitReview()} loading={busy}>
              {t('common.submit')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {reviewError && <Notice tone="danger">{reviewError}</Notice>}
          <RatingInput
            label={t('customer.reviewProduct')}
            value={productRating}
            onChange={setProductRating}
          />
          <RatingInput
            label={t('customer.reviewSeller')}
            value={sellerRating}
            onChange={setSellerRating}
          />
          <TextArea
            name="comment"
            label={t('customer.reviewComment')}
            placeholder={t('customer.reviewCommentPlaceholder')}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          <p className="text-xs text-soil-500">{t('customer.verifiedPurchase')}</p>
        </div>
      </Modal>
    </RoleShell>
  );
}
