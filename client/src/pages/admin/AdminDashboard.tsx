import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, CircleSlash, Package, ShoppingCart, Sprout, Users } from 'lucide-react';
import { RoleShell } from '@/components/layout/RoleShell';
import { useAsync } from '@/hooks/useCart';
import { admin as adminApi } from '@/lib/services';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, EmptyState, ErrorState, Spinner, StatTile } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badge';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { formatINR, formatRelative, orderStatusKey, orderStatusTone } from '@/lib/format';
import type { OrderStatus } from '@/lib/types';

interface AdminOverviewResponse {
  counts: Record<string, number>;
  recentOrders: Array<{
    id: string;
    order_number: string;
    total_amount: number;
    order_status: OrderStatus;
    created_at: string;
    customer_name: string;
    farmer_name: string;
  }>;
  pendingVerifications: number;
  openReports: number;
  pendingQualityReviews: number;
}

/** The administrator overview. Every figure is a live database count. */
export default function AdminDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  useDocumentTitle(t('admin.overview'));

  const result = useAsync((signal) => adminApi.overview(signal), []);
  const overview = result.data as unknown as AdminOverviewResponse | null;

  if (result.loading) {
    return (
      <RoleShell role="admin" title={t('admin.overview')}>
        <Spinner />
      </RoleShell>
    );
  }

  if (result.error || !overview) {
    return (
      <RoleShell role="admin" title={t('admin.overview')}>
        <ErrorState
          message={result.error ?? t('common.somethingWentWrong')}
          onRetry={result.reload}
        />
      </RoleShell>
    );
  }

  const counts = overview.counts ?? {};

  return (
    <RoleShell role="admin" title={t('admin.overview')}>
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label={t('admin.registeredFarmers')}
            value={counts['farmers'] ?? 0}
            tone="leaf"
            icon={<Sprout className="size-4" aria-hidden="true" />}
          />
          <StatTile
            label={t('admin.registeredCustomers')}
            value={counts['customers'] ?? 0}
            icon={<Users className="size-4" aria-hidden="true" />}
          />
          <StatTile
            label={t('admin.activeListings')}
            value={counts['active_listings'] ?? 0}
            icon={<Package className="size-4" aria-hidden="true" />}
          />
          <StatTile
            label={t('admin.totalOrders')}
            value={counts['total_orders'] ?? 0}
            icon={<ShoppingCart className="size-4" aria-hidden="true" />}
          />
          <StatTile label={t('admin.gmv')} value={formatINR(counts['gross_sales'] ?? 0)} />
          <StatTile
            label={t('order.paymentPaid')}
            value={formatINR(counts['captured_amount'] ?? 0)}
            hint={`${counts['captured_payments'] ?? 0} ${t('common.results')}`}
          />
          <StatTile
            label={t('admin.pendingVerifications')}
            value={overview.pendingVerifications}
            tone="warning"
            icon={<AlertTriangle className="size-4" aria-hidden="true" />}
          />
          <StatTile
            label={t('admin.openReports')}
            value={overview.openReports}
            tone="warning"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardBody>
              <p className="text-xs font-semibold uppercase text-soil-600">
                {t('admin.qualityReviews')}
              </p>
              <p className="tabular mt-1 text-2xl font-bold text-soil-900">
                {overview.pendingQualityReviews}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => navigate('/admin/quality-reviews')}
              >
                {t('common.viewAll')}
              </Button>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <p className="text-xs font-semibold uppercase text-soil-600">
                {t('admin.suspendedAccounts')}
              </p>
              <p className="tabular mt-1 text-2xl font-bold text-soil-900">
                {counts['suspended_accounts'] ?? 0}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => navigate('/admin/users')}
              >
                {t('admin.users')}
              </Button>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <p className="text-xs font-semibold uppercase text-soil-600">
                {t('order.paymentFailed')}
              </p>
              <p className="tabular mt-1 text-2xl font-bold text-soil-900">
                {counts['failed_payments'] ?? 0}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => navigate('/admin/orders')}
              >
                {t('admin.orders')}
              </Button>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <p className="text-xs font-semibold uppercase text-soil-600">{t('admin.reports')}</p>
              <p className="tabular mt-1 text-2xl font-bold text-soil-900">
                {counts['hidden_reviews'] ?? 0}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => navigate('/admin/reports')}
              >
                {t('common.viewAll')}
              </Button>
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader
            title={t('farmer.recentOrders')}
            action={
              <Button size="sm" variant="ghost" onClick={() => navigate('/admin/orders')}>
                {t('common.viewAll')}
              </Button>
            }
          />
          {overview.recentOrders.length === 0 ? (
            <CardBody>
              <EmptyState
                icon={<CheckCircle2 className="size-6" aria-hidden="true" />}
                title={t('common.noData')}
                description={t('admin.auditHelp')}
              />
            </CardBody>
          ) : (
            <CardBody className="space-y-2">
              {overview.recentOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-soil-200 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-soil-900">{order.order_number}</p>
                    <p className="text-xs text-soil-600">
                      {order.customer_name} → {order.farmer_name} ·{' '}
                      {formatRelative(order.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge tone={orderStatusTone(order.order_status)}>
                      {t(orderStatusKey(order.order_status))}
                    </StatusBadge>
                    <span className="tabular font-bold text-soil-900">
                      {formatINR(order.total_amount)}
                    </span>
                  </div>
                </div>
              ))}
            </CardBody>
          )}
        </Card>

        <p className="flex items-center gap-1.5 text-xs text-soil-500">
          <CircleSlash className="size-3.5" aria-hidden="true" />
          {t('admin.auditHelp')}
        </p>
      </div>
    </RoleShell>
  );
}
