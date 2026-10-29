import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ClipboardList, Package } from 'lucide-react';
import { RoleShell } from '@/components/layout/RoleShell';
import { useAsync } from '@/hooks/useCart';
import { orders as ordersApi } from '@/lib/services';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, EmptyState, ErrorState, Spinner } from '@/components/ui/Card';
import { Select } from '@/components/ui/Field';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/Badge';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  formatINR,
  formatRelative,
  orderStatusKey,
  orderStatusTone,
  paymentStatusKey,
} from '@/lib/format';
import type { Order, OrderStatus } from '@/lib/types';

/**
 * Orders placed with this farmer.
 *
 * The list endpoint already scopes rows to the signed-in farmer through row
 * level security, so there is no client-side filtering to get wrong.
 */
const FILTERS: Array<{ value: string; labelKey: string }> = [
  { value: '', labelKey: 'common.clearAll' },
  { value: 'pending_confirmation', labelKey: 'order.statusPendingConfirmation' },
  { value: 'accepted', labelKey: 'order.statusAccepted' },
  { value: 'preparing', labelKey: 'order.statusPreparing' },
  { value: 'shipped', labelKey: 'order.statusShipped' },
  { value: 'delivered', labelKey: 'order.statusDelivered' },
  { value: 'cancelled', labelKey: 'order.statusCancelled' },
];

export default function FarmerOrders() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  useDocumentTitle(t('nav.incomingOrders'));

  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const result = useAsync(
    (signal) => ordersApi.list({ ...(status ? { status } : {}), page }, signal),
    [status, page],
  );

  const items = result.data?.items ?? [];

  return (
    <RoleShell role="farmer" title={t('nav.incomingOrders')}>
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
            description={t('customer.noOrders')}
            action={<Button onClick={() => navigate('/farmer/products')}>{t('nav.myProducts')}</Button>}
          />
        )}

        {items.length > 0 && (
          <div className="space-y-3">
            {items.map((order: Order) => (
              <Card key={order.id}>
                <CardBody className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <Link
                      to={`/farmer/orders/${order.id}`}
                      className="font-bold text-soil-900 hover:text-leaf-800 hover:underline"
                    >
                      {order.order_number}
                    </Link>
                    <p className="text-sm text-soil-600">
                      {t('product.soldBy', { name: order.customer_name })}
                    </p>
                    <p className="text-xs text-soil-500">
                      {formatRelative(order.created_at)} ·{' '}
                      {order.fulfilment_method === 'pickup' ? t('customer.pickup') : t('customer.delivery')}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <StatusBadge tone={orderStatusTone(order.order_status as OrderStatus)}>
                      {t(orderStatusKey(order.order_status as OrderStatus))}
                    </StatusBadge>
                    <StatusBadge tone="neutral">
                      {t(paymentStatusKey(order.payment_status))}
                    </StatusBadge>
                    <span className="tabular font-bold text-soil-900">
                      {formatINR(order.total_amount)}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigate(`/farmer/orders/${order.id}`)}
                    >
                      <Package className="size-4" aria-hidden="true" />
                      {t('common.viewDetails')}
                    </Button>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}

        {result.data && result.data.total_pages > 1 && (
          <Pagination page={page} totalPages={result.data.total_pages} onPageChange={setPage} />
        )}
      </div>
    </RoleShell>
  );
}
