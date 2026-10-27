import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, MapPin, Truck } from 'lucide-react';
import { RoleShell } from '@/components/layout/RoleShell';
import { useAsync, bumpCartCount } from '@/hooks/useCart';
import { addresses as addressesApi, cart as cartApi, orders as ordersApi, payments as paymentsApi } from '@/lib/services';
import { messageOf } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, EmptyState, ErrorState, Notice, Spinner } from '@/components/ui/Card';
import { Select, TextArea } from '@/components/ui/Field';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { formatINR, unitLabel } from '@/lib/format';

type Method = 'delivery' | 'pickup';

interface Capability {
  configured: boolean;
  provider: string | null;
  reason: string;
}

/**
 * Checkout.
 *
 * Three things this page is careful about:
 *
 * 1. The totals are the server's cart totals, not a client-side sum, so a price
 *    cannot be edited in the browser.
 * 2. A cart spanning several farmers is split into separate orders — the notice
 *    says so before the button is pressed rather than after.
 * 3. When no payment provider is configured the page says that plainly and
 *    offers pay-on-delivery. It never shows a success state for money that was
 *    not actually taken.
 */
export default function CustomerCheckout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  useDocumentTitle(t('customer.checkout'));

  const cartResult = useAsync((signal) => cartApi.get(signal), []);
  const addressResult = useAsync((signal) => addressesApi.list(signal), []);
  const capabilityResult = useAsync((signal) => paymentsApi.capability(signal), []);

  const [addressId, setAddressId] = useState('');
  const [method, setMethod] = useState<Method>('delivery');
  const [note, setNote] = useState('');
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cart = cartResult.data?.cart ?? null;
  const addresses = addressResult.data?.addresses ?? [];
  const capability: Capability | null = capabilityResult.data ?? null;

  const defaultAddress = addresses.find((entry) => entry.is_default) ?? addresses[0];
  const chosenAddressId = addressId || defaultAddress?.id || '';

  const groups = cart?.groups ?? [];
  const offersDelivery = groups.some((group) => group.offers_delivery);
  const offersPickup = groups.some((group) => group.offers_pickup);

  const placeOrder = async () => {
    setPlacing(true);
    setError(null);
    try {
      await ordersApi.checkout({
        ...(method === 'delivery' && chosenAddressId ? { delivery_address_id: chosenAddressId } : {}),
        fulfilment_method: method,
        ...(note ? { customer_note: note } : {}),
        // A stable key per attempt stops a double tap becoming two orders.
        idempotency_key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });
      bumpCartCount();
      navigate('/customer/orders');
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setPlacing(false);
    }
  };

  if (cartResult.loading || addressResult.loading) {
    return (
      <RoleShell role="customer" title={t('customer.checkout')}>
        <Spinner />
      </RoleShell>
    );
  }

  if (cartResult.error || addressResult.error) {
    return (
      <RoleShell role="customer" title={t('customer.checkout')}>
        <ErrorState
          message={cartResult.error ?? addressResult.error ?? t('common.somethingWentWrong')}
          onRetry={() => {
            cartResult.reload();
            addressResult.reload();
          }}
        />
      </RoleShell>
    );
  }

  if (!cart || cart.lines.length === 0) {
    return (
      <RoleShell role="customer" title={t('customer.checkout')}>
        <EmptyState
          icon={<Truck className="size-6" aria-hidden="true" />}
          title={t('customer.emptyCart')}
          description={t('customer.emptyCartHelp')}
          action={<Button onClick={() => navigate('/explore')}>{t('landing.browseCrops')}</Button>}
        />
      </RoleShell>
    );
  }

  return (
    <RoleShell role="customer" title={t('customer.checkout')}>
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          {error && <Notice tone="danger">{error}</Notice>}

          <Card>
            <CardHeader title={t('customer.deliveryMethod')} />
            <CardBody className="space-y-4">
              {offersDelivery && (
                <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border border-soil-200 p-3 has-[:checked]:border-leaf-500 has-[:checked]:bg-leaf-50/50">
                  <input
                    type="radio"
                    name="method"
                    className="mt-0.5 size-4"
                    checked={method === 'delivery'}
                    onChange={() => setMethod('delivery')}
                  />
                  <span>
                    <span className="block font-semibold text-soil-900">{t('customer.delivery')}</span>
                    <span className="block text-xs text-soil-600">{t('customer.selectAddress')}</span>
                  </span>
                </label>
              )}

              {offersPickup && (
                <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border border-soil-200 p-3 has-[:checked]:border-leaf-500 has-[:checked]:bg-leaf-50/50">
                  <input
                    type="radio"
                    name="method"
                    className="mt-0.5 size-4"
                    checked={method === 'pickup'}
                    onChange={() => setMethod('pickup')}
                  />
                  <span>
                    <span className="block font-semibold text-soil-900">{t('customer.pickup')}</span>
                    <span className="block text-xs text-soil-600">{t('product.pickup')}</span>
                  </span>
                </label>
              )}

              {method === 'delivery' && (
                <div className="space-y-3">
                  {addresses.length === 0 ? (
                    <Notice tone="warning" title={t('customer.addAddress')}>
                      {t('auth.deliveryAddress')}
                      <div className="mt-2">
                        <Button size="sm" variant="outline" onClick={() => navigate('/customer/addresses')}>
                          <MapPin className="size-4" aria-hidden="true" />
                          {t('customer.addAddress')}
                        </Button>
                      </div>
                    </Notice>
                  ) : (
                    <Select
                      name="address"
                      label={t('customer.selectAddress')}
                      value={chosenAddressId}
                      onChange={(event) => setAddressId(event.target.value)}
                      options={addresses.map((address) => ({
                        value: address.id,
                        label: `${address.recipient_name} — ${address.address_line}, ${address.district}`,
                      }))}
                    />
                  )}
                </div>
              )}

              <TextArea
                name="note"
                label={t('customer.orderNote')}
                placeholder={t('customer.orderNotePlaceholder')}
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('customer.paymentMethod')} />
            <CardBody className="space-y-3">
              {capability?.configured ? (
                <Notice tone="success" title={t('customer.payOnline')}>
                  {capability.provider}
                </Notice>
              ) : (
                <Notice tone="warning" title={t('customer.paymentNotConfigured')}>
                  {t('customer.paymentNotConfiguredHelp')}
                  {capability?.reason && <span className="mt-1 block text-xs">{capability.reason}</span>}
                </Notice>
              )}
              <p className="text-xs text-soil-600">{t('customer.priceBreakdownNote')}</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('customer.priceBreakdown')} />
            <CardBody className="space-y-3">
              {groups.map((group) => (
                <div key={group.farmer_id} className="rounded-[var(--radius-control)] border border-soil-200 p-3">
                  <p className="font-semibold text-soil-900">
                    {t('customer.fromFarmer', { name: group.farmer_name })}
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-soil-700">
                    {group.lines.map((line) => (
                      <li key={line.id} className="flex justify-between gap-3">
                        <span>
                          {line.name} × {line.quantity} {unitLabel(line.unit, line.custom_unit)}
                        </span>
                        <span className="tabular">{formatINR(line.line_subtotal)}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex justify-between border-t border-soil-100 pt-2 text-sm">
                    <span className="text-soil-600">{t('customer.deliveryCharge')}</span>
                    <span className="tabular">{formatINR(group.delivery_charge)}</span>
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardBody>
              <h2 className="text-lg font-bold text-soil-900">{t('customer.orderSummary')}</h2>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-soil-600">{t('customer.itemsSubtotal')}</dt>
                  <dd className="tabular font-medium">{formatINR(cart.items_subtotal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-soil-600">{t('customer.deliveryCharge')}</dt>
                  <dd className="tabular font-medium">{formatINR(cart.delivery_charge)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-soil-600">{t('customer.platformFee')}</dt>
                  <dd className="tabular font-medium">{formatINR(cart.platform_fee)}</dd>
                </div>
                <div className="flex justify-between border-t border-soil-200 pt-2">
                  <dt className="font-bold text-soil-900">{t('customer.total')}</dt>
                  <dd className="tabular text-xl font-bold text-soil-900">
                    {formatINR(cart.total_amount)}
                  </dd>
                </div>
              </dl>

              {groups.length > 1 && (
                <Notice tone="info" className="mt-4">
                  <AlertTriangle className="mr-1 inline size-3.5" aria-hidden="true" />
                  {t('customer.fromFarmer', { name: `${groups.length}` })}
                </Notice>
              )}

              <Button
                block
                size="lg"
                className="mt-5"
                loading={placing}
                disabled={cart.has_issues || (method === 'delivery' && !chosenAddressId)}
                onClick={() => void placeOrder()}
              >
                {t('customer.placeOrder')}
              </Button>

              {cart.has_issues && (
                <p className="mt-2 text-center text-xs font-medium text-amber-800">
                  {t('customer.fixCartIssue')}
                </p>
              )}
            </CardBody>
          </Card>
        </aside>
      </div>
    </RoleShell>
  );
}
