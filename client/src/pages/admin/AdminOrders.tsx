import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardList } from 'lucide-react';
import { RoleShell } from '@/components/layout/RoleShell';
import { useAsync } from '@/hooks/useCart';
import { admin as adminApi } from '@/lib/services';
import { Card, CardBody, EmptyState, ErrorState, Spinner } from '@/components/ui/Card';
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
import type { OrderStatus, PaymentStatus } from '@/lib/types';

interface AdminOrder {
  id: string;
  order_number: string;
  total_amount: number;
  order_status: OrderStatus;
  payment_status: PaymentStatus;
  fulfilment_method: string;
  created_at: string;
  customer_name: string;
  farmer_name: string;
  item_count: number;
  latest_payment_status: string | null;
}

const FILTERS: Array<{ value: string; labelKey: string }> = [
  { value: '', labelKey: 'common.clearAll' },
  { value: 'pending_confirmation', labelKey: 'order.statusPendingConfirmation' },
  { value: 'accepted', labelKey: 'order.statusAccepted' },
  { value: 'delivered', labelKey: 'order.statusDelivered' },
  { value: 'cancelled', labelKey: 'order.statusCancelled' },
  { value: 'refunded', labelKey: 'order.statusRefunded' },
];

/**
 * Every order on the platform, read-only.
 *
 * Administrators can see payment state but cannot alter it here — a payment
 * status is set by the provider callback or a refund, never by an admin editing
 * a field.
 */
export default function AdminOrders() {
  const { t } = useTranslation();
  useDocumentTitle(t('admin.orders'));

  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const result = useAsync(
    (signal) => adminApi.orders({ ...(status ? { status } : {}), page }, signal),
    [status, page],
  );

  const items = (result.data?.items ?? []) as unknown as AdminOrder[];

  return (
    <RoleShell role="admin" title={t('admin.orders')}>
      <div className="space-y-5">
        <Card>
          <CardBody className="w-full sm:w-64">
            <Select
              name="status"
              label={t('common.filter')}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              options={FILTERS.map((entry) => ({
                value: entry.value,
                label: entry.value === '' ? t('common.clearAll') : t(entry.labelKey),
              }))}
            />
          </CardBody>
        </Card>

        {result.loading && <Spinner />}
        {!result.loading && result.error && (
          <ErrorState message={result.error} onRetry={result.reload} />
        )}

        {!result.loading && !result.error && items.length === 0 && (
          <EmptyState
            icon={<ClipboardList className="size-6" aria-hidden="true" />}
            title={t('common.noData')}
            description={t('admin.orders')}
          />
        )}

        {items.length > 0 && (
          <Card>
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-soil-50 text-left text-xs uppercase text-soil-600">
                    <tr>
                      <th className="px-5 py-2.5">{t('farmer.orderNumber')}</th>
                      <th className="px-5 py-2.5">{t('admin.registeredCustomers')}</th>
                      <th className="px-5 py-2.5">{t('product.farmer')}</th>
                      <th className="px-5 py-2.5">{t('customer.total')}</th>
                      <th className="px-5 py-2.5">{t('order.orderStatus')}</th>
                      <th className="px-5 py-2.5">{t('customer.paymentMethod')}</th>
                      <th className="px-5 py-2.5">{t('order.placedOn')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-soil-100">
                    {items.map((order) => (
                      <tr key={order.id}>
                        <td className="px-5 py-2.5 font-medium text-soil-900">
                          {order.order_number}
                        </td>
                        <td className="px-5 py-2.5 text-soil-700">{order.customer_name}</td>
                        <td className="px-5 py-2.5 text-soil-700">{order.farmer_name}</td>
                        <td className="tabular px-5 py-2.5 font-semibold">
                          {formatINR(order.total_amount)}
                        </td>
                        <td className="px-5 py-2.5">
                          <StatusBadge tone={orderStatusTone(order.order_status)}>
                            {t(orderStatusKey(order.order_status))}
                          </StatusBadge>
                        </td>
                        <td className="px-5 py-2.5">
                          {t(paymentStatusKey(order.payment_status))}
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

        {result.data && result.data.total_pages > 1 && (
          <Pagination page={page} totalPages={result.data.total_pages} onPageChange={setPage} />
        )}
      </div>
    </RoleShell>
  );
}
