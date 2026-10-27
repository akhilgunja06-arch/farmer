import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ClipboardList, ShoppingCart, Sprout, Star } from 'lucide-react';
import { RoleShell } from '@/components/layout/RoleShell';
import { useAsync } from '@/hooks/useCart';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Spinner,
  StatTile,
} from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badge';
import { ProductCard } from '@/components/marketplace/ProductCard';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  formatINR,
  formatRelative,
  orderStatusKey,
  orderStatusTone,
} from '@/lib/format';
import type { OrderStatus, ProductSummary } from '@/lib/types';

interface CustomerDashboardData {
  order_stats: {
    pending_orders?: number;
    active_orders?: number;
    completed_orders?: number;
    cancelled_orders?: number;
    total_spent?: number;
    total_orders?: number;
  };
  recent_orders: Array<{
    id: string;
    order_number: string;
    total_amount: number;
    order_status: OrderStatus;
    payment_status: string;
    created_at: string;
    farmer_name: string;
    first_item_name: string | null;
  }>;
  recommended: ProductSummary[];
  pending_reviews: Array<{
    order_id: string;
    product_id: string | null;
    farmer_id: string;
    product_name: string | null;
    farmer_name: string;
  }>;
  unread_messages: number;
}

/**
 * The customer home.
 *
 * Every figure is read from the database. "Total spent" counts delivered orders
 * only, since money for an order still in transit has not really been spent yet.
 */
export default function CustomerDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  useDocumentTitle(t('customer.home'));

  const result = useAsync(
    (signal) => api.get<CustomerDashboardData>('/api/dashboard/customer', undefined, signal),
    [],
  );

  if (result.loading) {
    return (
      <RoleShell role="customer" title={t('customer.home')}>
        <Spinner />
      </RoleShell>
    );
  }

  if (result.error) {
    return (
      <RoleShell role="customer" title={t('customer.home')}>
        <ErrorState message={result.error} onRetry={result.reload} />
      </RoleShell>
    );
  }

  const stats = result.data?.order_stats ?? {};
  const recent = result.data?.recent_orders ?? [];
  const recommended = result.data?.recommended ?? [];
  const pendingReviews = result.data?.pending_reviews ?? [];

  return (
    <RoleShell role="customer" title={t('customer.home')}>
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label={t('customer.orders')}
            value={stats.total_orders ?? 0}
            icon={<ClipboardList className="size-4" aria-hidden="true" />}
          />
          <StatTile
            label={t('farmer.pendingOrders')}
            value={stats.active_orders ?? 0}
            tone="info"
          />
          <StatTile
            label={t('farmer.completedOrders')}
            value={stats.completed_orders ?? 0}
            tone="leaf"
          />
          <StatTile label={t('order.orderTotal')} value={formatINR(stats.total_spent ?? 0)} />
        </div>

        {pendingReviews.length > 0 && (
          <Card>
            <CardHeader
              title={t('customer.pendingReview')}
              subtitle={t('customer.reviewCommentPlaceholder')}
              action={
                <Button size="sm" variant="outline" onClick={() => navigate('/customer/orders')}>
                  {t('customer.orders')}
                </Button>
              }
            />
            <CardBody className="space-y-2">
              {pendingReviews.map((entry) => (
                <div
                  key={`${entry.order_id}-${entry.product_id ?? 'seller'}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-soil-200 px-3 py-2"
                >
                  <span className="text-sm text-soil-800">
                    <Star className="mr-1 inline size-3.5 text-sun-500" aria-hidden="true" />
                    {entry.product_name ?? entry.farmer_name}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate(`/customer/orders/${entry.order_id}`)}
                  >
                    {t('customer.writeReview')}
                  </Button>
                </div>
              ))}
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader
            title={t('customer.orders')}
            action={
              <Button size="sm" variant="ghost" onClick={() => navigate('/customer/orders')}>
                {t('common.viewAll')}
              </Button>
            }
          />
          {recent.length === 0 ? (
            <CardBody>
              <EmptyState
                icon={<ShoppingCart className="size-6" aria-hidden="true" />}
                title={t('customer.noOrders')}
                description={t('customer.emptyCartHelp')}
                action={
                  <Button onClick={() => navigate('/explore')}>{t('landing.browseCrops')}</Button>
                }
              />
            </CardBody>
          ) : (
            <CardBody className="space-y-2">
              {recent.map((order) => (
                <Link
                  key={order.id}
                  to={`/customer/orders/${order.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-soil-200 px-3 py-2.5 hover:border-leaf-300 hover:bg-leaf-50/40"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-soil-900">{order.order_number}</p>
                    <p className="text-xs text-soil-600">
                      {order.first_item_name ?? t('product.soldBy', { name: order.farmer_name })} ·{' '}
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
                </Link>
              ))}
            </CardBody>
          )}
        </Card>

        <Card>
          <CardHeader
            title={t('landing.freshListings')}
            subtitle={t('landing.freshListingsSub')}
            action={
              <Button size="sm" variant="ghost" onClick={() => navigate('/explore')}>
                {t('common.viewAll')}
              </Button>
            }
          />
          <CardBody>
            {recommended.length === 0 ? (
              <EmptyState
                icon={<Sprout className="size-6" aria-hidden="true" />}
                title={t('common.noData')}
                description={t('landing.freshListingsSub')}
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {recommended.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </RoleShell>
  );
}
