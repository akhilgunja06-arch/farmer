import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ClipboardList, Package, PlusCircle, Sprout, TrendingUp, Wallet } from 'lucide-react';
import { RoleShell } from '@/components/layout/RoleShell';
import { useAsync } from '@/hooks/useCart';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/Button';
import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Notice,
  Spinner,
  StatTile,
} from '@/components/ui/Card';
import { Badge, StatusBadge, VerificationBadge } from '@/components/ui/Badge';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  formatINR,
  formatQuantity,
  formatRelative,
  orderStatusKey,
  orderStatusTone,
} from '@/lib/format';
import type { OrderStatus, PaymentStatus, VerificationStatus } from '@/lib/types';

interface FarmerDashboardData {
  listing_stats: {
    active_listings?: number;
    draft_listings?: number;
    out_of_stock?: number;
    available_stock?: number;
    total_listings?: number;
    total_views?: number;
  };
  order_stats: {
    pending_orders?: number;
    active_orders?: number;
    completed_orders?: number;
    cancelled_orders?: number;
    total_sales?: number;
    total_orders?: number;
  };
  earnings: {
    captured?: number;
    net?: number;
    refunded?: number;
    captured_count?: number;
    failed_count?: number;
  };
  recent_orders: Array<{
    id: string;
    order_number: string;
    total_amount: number;
    order_status: OrderStatus;
    payment_status: PaymentStatus;
    created_at: string;
    customer_name: string;
  }>;
  recent_inquiries: Array<{
    id: string;
    subject: string | null;
    updated_at: string;
    customer_name: string;
    last_message: string | null;
    unread_count: number;
  }>;
  sales_by_week: Array<{ week_start: string; order_count: number; value: number }>;
  top_products: Array<{
    id: string;
    name: string;
    price: number;
    unit: string;
    stock_quantity: number;
    status: string;
    quantity_sold: number;
    revenue: number;
    primary_image: string | null;
  }>;
  unread_messages: number;
}

/**
 * The farmer overview.
 *
 * Every figure comes from the database. Earnings are counted from captured
 * payments rather than order totals, because an unpaid order is not money
 * received — showing it as such would be misleading.
 */
export default function FarmerDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, farmerProfile } = useAuth();
  useDocumentTitle(t('farmer.overview'));

  const result = useAsync(
    (signal) => api.get<FarmerDashboardData>('/api/dashboard/farmer', undefined, signal),
    [],
  );

  if (result.loading) {
    return (
      <RoleShell role="farmer" title={t('farmer.overview')}>
        <Spinner />
      </RoleShell>
    );
  }

  if (result.error || !result.data) {
    return (
      <RoleShell role="farmer" title={t('farmer.overview')}>
        <ErrorState
          message={result.error ?? t('common.somethingWentWrong')}
          onRetry={result.reload}
        />
      </RoleShell>
    );
  }

  const data = result.data;
  const listings = data.listing_stats ?? {};
  const orders = data.order_stats ?? {};
  const earnings = data.earnings ?? {};
  const verification = (farmerProfile?.verification_status ?? 'unverified') as VerificationStatus;

  // Fill weeks the API omitted, so the chart shows a continuous timeline
  // rather than silently collapsing empty weeks.
  const weeks = buildWeekSeries(data.sales_by_week ?? []);

  return (
    <RoleShell
      role="farmer"
      title={t('farmer.overview')}
      headerAction={
        <Button size="sm" onClick={() => navigate('/farmer/products/new')}>
          <PlusCircle className="size-4" aria-hidden="true" />
          {t('nav.addCrop')}
        </Button>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-bold text-soil-900">
            {t('auth.welcomeBack')}, {user?.full_name?.split(' ')[0]}
          </h2>
          <VerificationBadge status={verification} />
          {verification !== 'verified' && (
            <Button variant="link" size="sm" onClick={() => navigate('/farmer/profile')}>
              {t('farmer.requestVerification')}
            </Button>
          )}
        </div>

        {verification === 'unverified' && (
          <Notice tone="info" title={t('farmer.verification')}>
            {t('farmer.verificationHelp')}
          </Notice>
        )}

        {data.unread_messages > 0 && (
          <Notice tone="warning">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                You have {data.unread_messages} unread{' '}
                {data.unread_messages === 1 ? 'message' : 'messages'} from customers.
              </span>
              <Button size="sm" variant="outline" onClick={() => navigate('/farmer/messages')}>
                {t('common.messages')}
              </Button>
            </div>
          </Notice>
        )}

        {/* --------------------------------------------------------- tiles */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label={t('farmer.totalListings')}
            value={formatQuantity(listings.active_listings ?? 0)}
            hint={
              (listings.draft_listings ?? 0) > 0 ? `${listings.draft_listings} draft` : undefined
            }
            icon={<Package className="size-4" aria-hidden="true" />}
            tone="leaf"
          />
          <StatTile
            label={t('farmer.availableStock')}
            value={formatQuantity(listings.available_stock ?? 0)}
            hint="Across active listings"
          />
          <StatTile
            label={t('farmer.pendingOrders')}
            value={formatQuantity(orders.pending_orders ?? 0)}
            hint={`${orders.active_orders ?? 0} in progress`}
            icon={<ClipboardList className="size-4" aria-hidden="true" />}
            tone={(orders.pending_orders ?? 0) > 0 ? 'warning' : 'neutral'}
          />
          <StatTile
            label={t('farmer.completedOrders')}
            value={formatQuantity(orders.completed_orders ?? 0)}
            hint={`${orders.total_orders ?? 0} orders total`}
          />
          <StatTile
            label={t('farmer.totalSales')}
            value={formatINR(orders.total_sales ?? 0)}
            hint="Delivered orders"
            icon={<TrendingUp className="size-4" aria-hidden="true" />}
          />
          <StatTile
            label={t('farmer.earnings')}
            value={formatINR(earnings.net ?? 0)}
            hint={`${earnings.captured_count ?? 0} payments received`}
            icon={<Wallet className="size-4" aria-hidden="true" />}
            tone="leaf"
          />
          <StatTile
            label="Refunded"
            value={formatINR(earnings.refunded ?? 0)}
            tone={(earnings.refunded ?? 0) > 0 ? 'warning' : 'neutral'}
          />
          <StatTile
            label="Listing views"
            value={formatQuantity(listings.total_views ?? 0)}
            hint="All time"
          />
        </div>

        {/* -------------------------------------------------------- charts */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title={t('farmer.productPerformance')}
              subtitle="Order value per week, last 12 weeks"
            />
            <CardBody>
              {weeks.some((week) => week.value > 0) ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={weeks} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-leaf-600)" stopOpacity={0.35} />
                          <stop
                            offset="100%"
                            stopColor="var(--color-leaf-600)"
                            stopOpacity={0.02}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--color-soil-200)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: 'var(--color-soil-600)' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: 'var(--color-soil-600)' }}
                        axisLine={false}
                        tickLine={false}
                        width={60}
                        tickFormatter={(value: number) =>
                          value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)
                        }
                      />
                      <Tooltip
                        formatter={(value) => [formatINR(Number(value)), 'Order value']}
                        contentStyle={{
                          borderRadius: 10,
                          border: '1px solid var(--color-soil-200)',
                          fontSize: 12,
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke="var(--color-leaf-700)"
                        strokeWidth={2}
                        fill="url(#salesFill)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState
                  title="No order activity yet"
                  description="Once you receive orders, your weekly order value will be charted here."
                  className="border-0 bg-transparent py-8"
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Top listings" subtitle="By revenue" />
            <CardBody>
              {data.top_products.length > 0 ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.top_products.map((product) => ({
                        name:
                          product.name.length > 14
                            ? `${product.name.slice(0, 13)}…`
                            : product.name,
                        revenue: Number(product.revenue),
                      }))}
                      margin={{ top: 5, right: 5, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--color-soil-200)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 11, fill: 'var(--color-soil-600)' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: 'var(--color-soil-600)' }}
                        axisLine={false}
                        tickLine={false}
                        width={60}
                        tickFormatter={(value: number) =>
                          value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)
                        }
                      />
                      <Tooltip
                        formatter={(value) => [formatINR(Number(value)), 'Revenue']}
                        contentStyle={{
                          borderRadius: 10,
                          border: '1px solid var(--color-soil-200)',
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="revenue" fill="var(--color-leaf-600)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState
                  title={t('farmer.noListings')}
                  description="Add a crop and it will appear here with its performance."
                  action={
                    <Button onClick={() => navigate('/farmer/products/new')}>
                      <PlusCircle className="size-4" aria-hidden="true" />
                      {t('farmer.addFirstCrop')}
                    </Button>
                  }
                  className="border-0 bg-transparent py-8"
                />
              )}
            </CardBody>
          </Card>
        </div>

        {/* -------------------------------------------------- recent lists */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title={t('farmer.recentOrders')}
              action={
                <Button variant="link" size="sm" onClick={() => navigate('/farmer/orders')}>
                  {t('common.viewAll')}
                </Button>
              }
            />
            <CardBody className="p-0">
              {data.recent_orders.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-soil-600">
                  No orders yet. They will appear here as soon as a customer places one.
                </p>
              ) : (
                <ul className="divide-y divide-soil-100">
                  {data.recent_orders.map((order) => (
                    <li key={order.id}>
                      <button
                        type="button"
                        onClick={() => navigate(`/farmer/orders/${order.id}`)}
                        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-soil-50"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-soil-900">
                            {order.order_number}
                          </p>
                          <p className="truncate text-xs text-soil-600">
                            {order.customer_name} · {formatRelative(order.created_at)}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className="tabular text-sm font-bold text-soil-900">
                            {formatINR(order.total_amount)}
                          </span>
                          <StatusBadge tone={orderStatusTone(order.order_status)}>
                            {t(orderStatusKey(order.order_status))}
                          </StatusBadge>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={t('farmer.recentInquiries')}
              action={
                <Button variant="link" size="sm" onClick={() => navigate('/farmer/messages')}>
                  {t('common.viewAll')}
                </Button>
              }
            />
            <CardBody className="p-0">
              {data.recent_inquiries.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-soil-600">
                  {t('messages.noConversations')} {t('messages.noConversationsHelp')}
                </p>
              ) : (
                <ul className="divide-y divide-soil-100">
                  {data.recent_inquiries.map((inquiry) => (
                    <li key={inquiry.id}>
                      <button
                        type="button"
                        onClick={() => navigate(`/farmer/messages?conversation=${inquiry.id}`)}
                        className="flex w-full items-start justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-soil-50"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-soil-900">
                            {inquiry.customer_name}
                          </p>
                          <p className="line-clamp-1 text-xs text-soil-600">
                            {inquiry.last_message ?? 'No messages yet'}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          {inquiry.unread_count > 0 && (
                            <Badge tone="leaf">{inquiry.unread_count} new</Badge>
                          )}
                          <span className="text-xs text-soil-500">
                            {formatRelative(inquiry.updated_at)}
                          </span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => navigate('/farmer/market-insights')}>
            <TrendingUp className="size-4" aria-hidden="true" />
            {t('nav.marketInsights')}
          </Button>
          <Button variant="outline" onClick={() => navigate('/farmer/earnings')}>
            <Wallet className="size-4" aria-hidden="true" />
            {t('nav.earnings')}
          </Button>
          <Button variant="outline" onClick={() => navigate('/farmer/profile')}>
            <Sprout className="size-4" aria-hidden="true" />
            {t('nav.farmProfile')}
          </Button>
        </div>
      </div>
    </RoleShell>
  );
}

/**
 * Expands the API's sparse weekly rows into a continuous 12-week series.
 * Weeks with no orders are not returned at all, and a chart that skips them
 * misrepresents the trend.
 */
function buildWeekSeries(
  rows: Array<{ week_start: string; order_count: number; value: number }>,
): Array<{ label: string; value: number; orders: number }> {
  const byWeek = new Map<string, { order_count: number; value: number }>();
  for (const row of rows) {
    byWeek.set(String(row.week_start).slice(0, 10), {
      order_count: Number(row.order_count),
      value: Number(row.value),
    });
  }

  const series: Array<{ label: string; value: number; orders: number }> = [];
  const start = new Date();
  // Align to Monday, matching date_trunc('week') in the query.
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  start.setHours(0, 0, 0, 0);

  for (let offset = 11; offset >= 0; offset -= 1) {
    const weekStart = new Date(start);
    weekStart.setDate(start.getDate() - offset * 7);
    const key = weekStart.toISOString().slice(0, 10);
    const entry = byWeek.get(key);
    series.push({
      label: weekStart.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      value: entry ? Math.round(entry.value * 100) / 100 : 0,
      orders: entry?.order_count ?? 0,
    });
  }

  return series;
}
