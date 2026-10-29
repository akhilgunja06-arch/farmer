import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wallet } from 'lucide-react';
import { RoleShell } from '@/components/layout/RoleShell';
import { useAsync } from '@/hooks/useCart';
import { api } from '@/lib/api';
import { orders as ordersApi } from '@/lib/services';
import { Card, CardBody, CardHeader, EmptyState, ErrorState, Notice, Spinner, StatTile } from '@/components/ui/Card';
import { Select } from '@/components/ui/Field';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/Badge';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  formatDate,
  formatINR,
  orderStatusKey,
  orderStatusTone,
  paymentStatusKey,
} from '@/lib/format';
import type { Order, OrderStatus, PaymentStatus } from '@/lib/types';

interface FarmerDashboardResponse {
  earnings: {
    captured: number;
    net: number;
    refunded: number;
    captured_count: number;
    failed_count: number;
  };
}

// The orders endpoint filters on order_status only, so that is what is offered
// here. A payment-status filter that the server silently ignored would be worse
// than not offering one.
const STATUS_FILTERS: Array<{ value: string; labelKey: string }> = [
  { value: '', labelKey: 'common.clearAll' },
  { value: 'pending_confirmation', labelKey: 'order.statusPendingConfirmation' },
  { value: 'accepted', labelKey: 'order.statusAccepted' },
  { value: 'delivered', labelKey: 'order.statusDelivered' },
  { value: 'cancelled', labelKey: 'order.statusCancelled' },
  { value: 'refunded', labelKey: 'order.statusRefunded' },
];

/**
 * Payments and earnings.
 *
 * "Earnings" means money actually captured, taken from the dashboard summary
 * rather than summed from order totals on the client — an unpaid or failed
 * order is not income, and presenting it as such would mislead the person
 * relying on the figure. The transaction table below is the order list scoped
 * to this farmer by row level security, showing each order's payment state.
 */
export default function FarmerEarnings() {
  const { t } = useTranslation();
  useDocumentTitle(t('nav.earnings'));

  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const summary = useAsync(
    (signal) => api.get<FarmerDashboardResponse>('/api/dashboard/farmer', undefined, signal),
    [],
  );

  const ledger = useAsync(
    (signal) =>
      ordersApi.list({ ...(status ? { status } : {}), page }, signal),
    [status, page],
  );

  const earnings = summary.data?.earnings;
  const rows = ledger.data?.items ?? [];

  return (
    <RoleShell role="farmer" title={t('nav.earnings')}>
      <div className="space-y-5">
        {summary.loading && <Spinner />}
        {!summary.loading && summary.error && (
          <ErrorState message={summary.error} onRetry={summary.reload} />
        )}

        {earnings && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                label={t('farmer.earnings')}
                value={formatINR(earnings.captured)}
                tone="leaf"
                icon={<Wallet className="size-4" aria-hidden="true" />}
                hint={`${earnings.captured_count} ${t('common.results')}`}
              />
              <StatTile label={t('customer.total')} value={formatINR(earnings.net)} />
              <StatTile
                label={t('order.paymentRefunded')}
                value={formatINR(earnings.refunded)}
                tone="warning"
              />
              <StatTile
                label={t('order.paymentFailed')}
                value={earnings.failed_count}
                tone="warning"
              />
            </div>

            <Notice tone="info" title={t('market.disclosure')}>
              {t('market.cannotAdvise')}
            </Notice>
          </>
        )}

        <Card>
          <CardBody className="w-full sm:w-64">
            <Select
              name="status"
              label={t('order.orderStatus')}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              options={STATUS_FILTERS.map((entry) => ({
                value: entry.value,
                label: entry.value === '' ? t('common.clearAll') : t(entry.labelKey),
              }))}
            />
          </CardBody>
        </Card>

        {ledger.loading && <Spinner />}
        {!ledger.loading && ledger.error && (
          <ErrorState message={ledger.error} onRetry={ledger.reload} />
        )}

        {!ledger.loading && !ledger.error && rows.length === 0 && (
          <EmptyState
            icon={<Wallet className="size-6" aria-hidden="true" />}
            title={t('common.noData')}
            description="Payments recorded against your orders will appear here."
          />
        )}

        {rows.length > 0 && (
          <Card>
            <CardHeader title={t('nav.earnings')} />
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-soil-50 text-left text-xs uppercase text-soil-600">
                    <tr>
                      <th className="px-5 py-2.5">{t('farmer.orderNumber')}</th>
                      <th className="px-5 py-2.5">{t('customer.total')}</th>
                      <th className="px-5 py-2.5">{t('order.orderStatus')}</th>
                      <th className="px-5 py-2.5">{t('customer.paymentMethod')}</th>
                      <th className="px-5 py-2.5">{t('order.placedOn')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-soil-100">
                    {rows.map((order: Order) => (
                      <tr key={order.id}>
                        <td className="px-5 py-2.5 font-medium text-soil-900">
                          {order.order_number}
                        </td>
                        <td className="tabular px-5 py-2.5 font-semibold">
                          {formatINR(order.total_amount)}
                        </td>
                        <td className="px-5 py-2.5">
                          <StatusBadge tone={orderStatusTone(order.order_status as OrderStatus)}>
                            {t(orderStatusKey(order.order_status as OrderStatus))}
                          </StatusBadge>
                        </td>
                        <td className="px-5 py-2.5">
                          {t(paymentStatusKey(order.payment_status as PaymentStatus))}
                        </td>
                        <td className="px-5 py-2.5 text-soil-600">{formatDate(order.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        )}

        {ledger.data && ledger.data.total_pages > 1 && (
          <Pagination page={page} totalPages={ledger.data.total_pages} onPageChange={setPage} />
        )}
      </div>
    </RoleShell>
  );
}
