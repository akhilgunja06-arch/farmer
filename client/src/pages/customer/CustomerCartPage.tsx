import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Minus, Plus, ShoppingCart, Trash2, Truck } from 'lucide-react';
import { RoleShell } from '@/components/layout/RoleShell';
import { useAsync, bumpCartCount } from '@/hooks/useCart';
import { cart as cartApi } from '@/lib/services';
import { fileUrl } from '@/components/marketplace/ProductCard';
import { messageOf } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, EmptyState, ErrorState, Notice, Spinner } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Modal';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { formatINR, formatQuantity, unitLabel } from '@/lib/format';

/**
 * The cart.
 *
 * The cart is stored server-side, not in the browser, so it survives a sign-in
 * on another device and cannot be edited by hand to change a price. The totals
 * shown here are the server's own totals.
 *
 * A cart spanning several farmers is split into one group per farmer, because
 * each farmer confirms and fulfils their own produce. That split is visible
 * before checkout rather than appearing as a surprise afterwards.
 */
export default function CustomerCartPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  useDocumentTitle(t('nav.myCart'));

  const result = useAsync((signal) => cartApi.get(signal), []);
  const [busyLine, setBusyLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const cart = result.data?.cart ?? null;

  const update = async (itemId: string, quantity: number) => {
    setBusyLine(itemId);
    setError(null);
    try {
      await cartApi.updateItem(itemId, quantity);
      result.reload();
      bumpCartCount();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusyLine(null);
    }
  };

  const remove = async (itemId: string) => {
    setBusyLine(itemId);
    setError(null);
    try {
      await cartApi.removeItem(itemId);
      result.reload();
      bumpCartCount();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusyLine(null);
    }
  };

  if (result.loading) {
    return (
      <RoleShell role="customer" title={t('nav.myCart')}>
        <Spinner />
      </RoleShell>
    );
  }

  if (result.error) {
    return (
      <RoleShell role="customer" title={t('nav.myCart')}>
        <ErrorState message={result.error} onRetry={result.reload} />
      </RoleShell>
    );
  }

  const lines = cart?.lines ?? [];

  if (lines.length === 0) {
    return (
      <RoleShell role="customer" title={t('nav.myCart')}>
        <EmptyState
          icon={<ShoppingCart className="size-6" aria-hidden="true" />}
          title={t('customer.emptyCart')}
          description={t('customer.emptyCartHelp')}
          action={
            <Button onClick={() => navigate('/explore')}>{t('landing.browseCrops')}</Button>
          }
        />
      </RoleShell>
    );
  }

  const hasIssues = cart?.has_issues ?? false;

  return (
    <RoleShell role="customer" title={t('nav.myCart')}>
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          {error && <Notice tone="danger">{error}</Notice>}

          {hasIssues && (
            <Notice tone="warning" title="Some items need attention">
              One or more items are no longer available in the quantity you asked for. Adjust or
              remove them before you continue. Checkout will refuse an order that exceeds the
              farmer&apos;s stock.
            </Notice>
          )}

          {(cart?.groups ?? []).map((group) => (
            <Card key={group.farmer_id}>
              <CardBody className="p-0">
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-soil-100 px-5 py-3">
                  <div>
                    <h2 className="font-bold text-soil-900">
                      {t('customer.fromFarmer', { name: group.farmer_name })}
                    </h2>
                    {group.district && (
                      <p className="text-xs text-soil-600">
                        {group.district}
                        {group.state ? `, ${group.state}` : ''}
                      </p>
                    )}
                  </div>
                  <span className="tabular text-sm font-bold text-soil-900">
                    {formatINR(group.total_amount)}
                  </span>
                </header>

                <ul className="divide-y divide-soil-100">
                  {group.lines.map((line) => {
                    const unit = unitLabel(line.unit, line.custom_unit);
                    const busy = busyLine === line.id;
                    const overStock = line.quantity > line.stock_quantity;
                    const belowMin = line.quantity < line.minimum_order_quantity;

                    return (
                      <li key={line.id} className="flex gap-4 p-5">
                        <Link
                          to={`/products/${line.product_id}`}
                          className="size-20 shrink-0 overflow-hidden rounded-lg bg-soil-100"
                        >
                          {line.image ? (
                            <img
                              src={fileUrl(line.image) ?? ''}
                              alt=""
                              className="size-full object-cover"
                            />
                          ) : (
                            <span className="grid size-full place-items-center text-soil-400">
                              <ShoppingCart className="size-6" aria-hidden="true" />
                            </span>
                          )}
                        </Link>

                        <div className="min-w-0 flex-1">
                          <Link
                            to={`/products/${line.product_id}`}
                            className="font-semibold text-soil-900 hover:text-leaf-800 hover:underline"
                          >
                            {line.name}
                          </Link>
                          {line.variety && (
                            <p className="text-xs text-soil-600">{line.variety}</p>
                          )}

                          <p className="tabular mt-1 text-sm text-soil-700">
                            {formatINR(line.effective_unit_price)} {t('product.perUnit', { unit })}
                            {line.bulk_applied && (
                              <span className="ml-2 rounded bg-leaf-50 px-1.5 py-0.5 text-xs font-semibold text-leaf-800">
                                {t('customer.bulkPriceApplied')}
                              </span>
                            )}
                          </p>

                          {!line.available && (
                            <p className="mt-1 text-xs font-semibold text-red-700">
                              {t('customer.itemUnavailable')}
                            </p>
                          )}
                          {line.available && overStock && (
                            <p className="mt-1 text-xs font-semibold text-amber-800">
                              {t('validation.quantityAboveStock', {
                                max: `${formatQuantity(line.stock_quantity)} ${unit}`,
                              })}
                            </p>
                          )}
                          {line.available && !overStock && belowMin && (
                            <p className="mt-1 text-xs font-semibold text-amber-800">
                              {t('validation.quantityBelowMin', {
                                min: `${formatQuantity(line.minimum_order_quantity)} ${unit}`,
                              })}
                            </p>
                          )}

                          <div className="mt-3 flex flex-wrap items-center gap-3">
                            <div className="flex items-center gap-1.5">
                              <Button
                                variant="outline"
                                size="icon"
                                disabled={busy || line.quantity <= line.minimum_order_quantity}
                                onClick={() =>
                                  void update(
                                    line.id,
                                    Math.max(
                                      line.minimum_order_quantity,
                                      line.quantity - line.minimum_order_quantity,
                                    ),
                                  )
                                }
                                aria-label={t('common.previous')}
                              >
                                <Minus className="size-3.5" aria-hidden="true" />
                              </Button>

                              <input
                                type="number"
                                value={line.quantity}
                                min={line.minimum_order_quantity}
                                max={line.stock_quantity}
                                step={line.minimum_order_quantity}
                                disabled={busy}
                                onChange={(event) => {
                                  const next = Number(event.target.value);
                                  if (Number.isFinite(next) && next > 0) {
                                    void update(line.id, next);
                                  }
                                }}
                                aria-label={`${t('customer.quantity')} — ${line.name}`}
                                className="tabular h-9 w-20 rounded-[var(--radius-control)] border border-soil-300 px-2 text-center text-sm font-semibold focus:border-leaf-600 focus:outline-none focus:ring-2 focus:ring-leaf-600/30"
                              />
                              <span className="text-xs text-soil-600">{unit}</span>

                              <Button
                                variant="outline"
                                size="icon"
                                disabled={busy || line.quantity >= line.stock_quantity}
                                onClick={() =>
                                  void update(
                                    line.id,
                                    Math.min(
                                      line.stock_quantity,
                                      line.quantity + line.minimum_order_quantity,
                                    ),
                                  )
                                }
                                aria-label={t('common.next')}
                              >
                                <Plus className="size-3.5" aria-hidden="true" />
                              </Button>
                            </div>

                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => void remove(line.id)}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                              {t('common.remove')}
                            </Button>
                          </div>
                        </div>

                        <div className="shrink-0 text-right">
                          <p className="tabular font-bold text-soil-900">
                            {formatINR(line.line_subtotal)}
                          </p>
                          <p className="text-xs text-soil-500">
                            {formatQuantity(line.quantity)} {unit}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-soil-100 px-5 py-3 text-sm">
                  <span className="flex items-center gap-1.5 text-soil-600">
                    <Truck className="size-4" aria-hidden="true" />
                    {t('customer.deliveryCharge')}
                  </span>
                  <span className="tabular font-semibold text-soil-800">
                    {formatINR(group.delivery_charge)}
                  </span>
                </footer>
              </CardBody>
            </Card>
          ))}

          <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)}>
            <Trash2 className="size-4" aria-hidden="true" />
            {t('customer.clearCart')}
          </Button>
        </div>

        {/* ---------------------------------------------------------- summary */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardBody>
              <h2 className="text-lg font-bold text-soil-900">{t('customer.orderSummary')}</h2>

              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-soil-600">{t('customer.itemsSubtotal')}</dt>
                  <dd className="tabular font-medium text-soil-800">
                    {formatINR(cart?.items_subtotal ?? 0)}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-soil-600">{t('customer.deliveryCharge')}</dt>
                  <dd className="tabular font-medium text-soil-800">
                    {formatINR(cart?.delivery_charge ?? 0)}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-soil-600">{t('customer.platformFee')}</dt>
                  <dd className="tabular font-medium text-soil-800">
                    {formatINR(cart?.platform_fee ?? 0)}
                  </dd>
                </div>
                <div className="flex items-center justify-between border-t border-soil-200 pt-2">
                  <dt className="font-bold text-soil-900">{t('customer.total')}</dt>
                  <dd className="tabular text-xl font-bold text-soil-900">
                    {formatINR(cart?.total_amount ?? 0)}
                  </dd>
                </div>
              </dl>

              {(cart?.groups.length ?? 0) > 1 && (
                <Notice tone="info" className="mt-4">
                  <AlertTriangle className="mr-1 inline size-3.5" aria-hidden="true" />
                  Your cart has produce from {cart?.groups.length} farmers. It will be split into{' '}
                  {cart?.groups.length} separate orders at checkout, one per farmer.
                </Notice>
              )}

              <Button
                block
                size="lg"
                className="mt-5"
                disabled={hasIssues}
                onClick={() => navigate('/customer/checkout')}
              >
                {t('customer.proceedToCheckout')}
              </Button>

              {hasIssues && (
                <p className="mt-2 text-center text-xs font-medium text-amber-800">
                  Resolve the items flagged above before continuing.
                </p>
              )}

              <Link
                to="/explore"
                className="mt-3 block text-center text-sm font-semibold text-leaf-700 hover:underline"
              >
                {t('customer.continueShopping')}
              </Link>
            </CardBody>
          </Card>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={async () => {
          await cartApi.clear();
          setConfirmClear(false);
          result.reload();
          bumpCartCount();
        }}
        title={t('customer.clearCart')}
        description="This removes every item from your cart. It cannot be undone."
        confirmLabel={t('customer.clearCart')}
      />
    </RoleShell>
  );
}
