import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Package, ShoppingBag, Truck, X } from 'lucide-react';
import { RoleShell } from '@/components/layout/RoleShell';
import { useAsync } from '@/hooks/useCart';
import { orders as ordersApi } from '@/lib/services';
import { ApiError, messageOf } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, ErrorState, Notice, Spinner } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/Modal';
import { TextArea } from '@/components/ui/Field';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  formatDateTime,
  formatINR,
  formatQuantity,
  orderStatusKey,
  orderStatusTone,
  paymentStatusKey,
  unitLabel,
} from '@/lib/format';
import type { OrderStatus } from '@/lib/types';

/**
 * A single order, from the farmer's side.
 *
 * The actions offered are only those valid for the current status — a farmer
 * cannot mark an order shipped before accepting it, and the server would refuse
 * the transition anyway. The UI reflects the same state machine rather than
 * offering buttons that will fail.
 */
export default function FarmerOrderDetail() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const result = useAsync((signal) => ordersApi.detail(id, signal), [id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  const [note, setNote] = useState('');

  const order = result.data ?? null;
  useDocumentTitle(order ? order.order_number : t('farmer.orderNumber'));

  const advance = async (status: OrderStatus, withNote?: string) => {
    setBusy(true);
    setError(null);
    try {
      await ordersApi.setStatus(id, status, withNote);
      result.reload();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
      } else {
        setError(messageOf(caught));
      }
    } finally {
      setBusy(false);
    }
  };

  if (result.loading) {
    return (
      <RoleShell role="farmer" title={t('farmer.orderNumber')}>
        <Spinner />
      </RoleShell>
    );
  }

  if (result.error || !order) {
    return (
      <RoleShell role="farmer" title={t('farmer.orderNumber')}>
        <ErrorState
          message={result.error ?? t('common.notFound')}
          onRetry={result.reload}
        />
      </RoleShell>
    );
  }

  const isPickup = order.fulfilment_method === 'pickup';

  // The transitions available from the current status. Kept as data so the
  // rendering below has no branching logic of its own.
  const transitions: Array<{
    status: OrderStatus;
    label: string;
    icon: typeof Check;
    variant?: 'primary' | 'secondary' | 'danger' | 'outline';
  }> =
    order.order_status === 'pending_confirmation'
      ? [
          { status: 'accepted', label: t('farmer.accept'), icon: Check },
          { status: 'cancelled', label: t('farmer.reject'), icon: X, variant: 'danger' },
        ]
      : order.order_status === 'accepted'
        ? [{ status: 'preparing', label: t('farmer.startPreparing'), icon: Package }]
        : order.order_status === 'preparing'
          ? isPickup
            ? [
                {
                  status: 'ready_for_pickup',
                  label: t('farmer.readyForPickup'),
                  icon: ShoppingBag,
                },
              ]
            : [{ status: 'shipped', label: t('farmer.markShipped'), icon: Truck }]
          : order.order_status === 'ready_for_pickup' || order.order_status === 'shipped'
            ? [{ status: 'delivered', label: t('farmer.markDelivered'), icon: Check }]
            : [];

  return (
    <RoleShell role="farmer" title={order.order_number}>
      <div className="space-y-5">
        <Button variant="ghost" size="sm" onClick={() => navigate('/farmer/orders')}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t('nav.incomingOrders')}
        </Button>

        {error && <Notice tone="danger">{error}</Notice>}

        <Card>
          <CardBody>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-soil-900">{order.order_number}</h2>
                <p className="mt-1 text-sm text-soil-600">
                  {t('order.placedOn')} {formatDateTime(order.created_at)}
                </p>
                <p className="mt-1 text-sm text-soil-700">
                  {t('product.farmer') === 'Farmer' ? 'Customer' : 'Customer'}:{' '}
                  <span className="font-semibold">{order.customer_name}</span>
                </p>
              </div>

              <div className="flex flex-col items-end gap-2">
                <StatusBadge tone={orderStatusTone(order.order_status)}>
                  {t(orderStatusKey(order.order_status))}
                </StatusBadge>
                <StatusBadge
                  tone={
                    order.payment_status === 'captured'
                      ? 'success'
                      : order.payment_status === 'failed'
                        ? 'danger'
                        : 'neutral'
                  }
                >
                  {t(paymentStatusKey(order.payment_status))}
                </StatusBadge>
              </div>
            </div>

            {transitions.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2 border-t border-soil-100 pt-5">
                {transitions.map((transition) =>
                  transition.status === 'cancelled' ? (
                    <Button
                      key={transition.status}
                      variant="danger"
                      onClick={() => setConfirmReject(true)}
                      disabled={busy}
                    >
                      <transition.icon className="size-4" aria-hidden="true" />
                      {transition.label}
                    </Button>
                  ) : (
                    <Button
                      key={transition.status}
                      variant={transition.variant ?? 'primary'}
                      onClick={() => void advance(transition.status, note || undefined)}
                      loading={busy}
                    >
                      <transition.icon className="size-4" aria-hidden="true" />
                      {transition.label}
                    </Button>
                  ),
                )}
              </div>
            )}

            {order.order_status !== 'cancelled' && order.order_status !== 'delivered' && (
              <div className="mt-4">
                <TextArea
                  name="order-note"
                  label={`Note to the customer (${t('common.optional')})`}
                  rows={2}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="e.g. Packed and ready, please collect before 6pm"
                />
              </div>
            )}
          </CardBody>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader title="Items" />
            <CardBody className="p-0">
              <ul className="divide-y divide-soil-100">
                {order.items.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-4 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-soil-900">
                        {item.product_name_snapshot}
                      </p>
                      <p className="tabular text-xs text-soil-600">
                        {formatQuantity(item.quantity)} × {formatINR(item.unit_price_snapshot)}{' '}
                        {unitLabel(item.unit_snapshot as never, null)}
                      </p>
                    </div>
                    <span className="tabular shrink-0 font-bold text-soil-900">
                      {formatINR(item.subtotal)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader title={t('customer.priceBreakdown')} />
              <CardBody>
                <dl className="space-y-2 text-sm">
                  <Row label={t('customer.itemsSubtotal')} value={formatINR(order.items_subtotal)} />
                  <Row
                    label={t('customer.deliveryCharge')}
                    value={formatINR(order.delivery_charge)}
                  />
                  <Row label={t('customer.platformFee')} value={formatINR(order.platform_fee)} />
                  <div className="flex items-center justify-between border-t border-soil-200 pt-2">
                    <dt className="font-bold text-soil-900">{t('customer.total')}</dt>
                    <dd className="tabular text-lg font-bold text-soil-900">
                      {formatINR(order.total_amount)}
                    </dd>
                  </div>
                </dl>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title={isPickup ? t('customer.pickup') : t('customer.delivery')} />
              <CardBody>
                {isPickup ? (
                  <p className="text-sm text-soil-700">
                    The customer will collect this order from your farm.
                  </p>
                ) : order.delivery_address_snapshot ? (
                  <address className="text-sm not-italic leading-relaxed text-soil-700">
                    {Object.entries(order.delivery_address_snapshot)
                      .filter(([, value]) => typeof value === 'string' && value)
                      .map(([key, value]) => (
                        <span key={key} className="block">
                          {String(value)}
                        </span>
                      ))}
                  </address>
                ) : (
                  <p className="text-sm text-soil-600">{t('common.notProvided')}</p>
                )}

                {order.customer_note && (
                  <Notice tone="info" className="mt-3">
                    <strong>Customer note:</strong> {order.customer_note}
                  </Notice>
                )}
              </CardBody>
            </Card>

            {order.payments.length > 0 && (
              <Card>
                <CardHeader title="Payments" />
                <CardBody>
                  <ul className="space-y-2 text-sm">
                    {order.payments.map((payment) => (
                      <li key={payment.id} className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-soil-800 capitalize">
                            {payment.provider}
                          </p>
                          <p className="text-xs text-soil-500">
                            {formatDateTime(payment.created_at)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="tabular font-bold text-soil-900">
                            {formatINR(payment.amount)}
                          </p>
                          <StatusBadge
                            tone={
                              payment.status === 'captured'
                                ? 'success'
                                : payment.status === 'failed'
                                  ? 'danger'
                                  : 'neutral'
                            }
                          >
                            {t(paymentStatusKey(payment.status))}
                          </StatusBadge>
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmReject}
        onClose={() => setConfirmReject(false)}
        onConfirm={async () => {
          await advance('cancelled', note || 'Rejected by the farmer.');
          setConfirmReject(false);
        }}
        title={t('farmer.reject')}
        description="Rejecting releases the stock this order was holding. The customer will see the order as cancelled."
        confirmLabel={t('farmer.reject')}
        loading={busy}
      />
    </RoleShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-soil-600">{label}</dt>
      <dd className="tabular font-medium text-soil-800">{value}</dd>
    </div>
  );
}
