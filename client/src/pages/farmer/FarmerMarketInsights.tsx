import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Info, TrendingUp } from 'lucide-react';
import { RoleShell } from '@/components/layout/RoleShell';
import { useAsync } from '@/hooks/useCart';
import { api } from '@/lib/api';
import { market as marketApi } from '@/lib/services';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, EmptyState, ErrorState, Notice, Spinner } from '@/components/ui/Card';
import { Select, TextInput } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { formatINR } from '@/lib/format';

interface MarketComparisonResponse {
  configured: boolean;
  sourceNote: string;
  commodity: string;
  state: string;
  district: string | null;
  unit: string;
  observations: Array<{
    id: string;
    market_name: string | null;
    min_price: number | null;
    max_price: number | null;
    modal_price: number | null;
    observed_on: string;
    source: string;
    age_days: number;
    freshness: 'current' | 'recent' | 'stale';
  }>;
  marketplace: {
    average_price: number | null;
    min_price: number | null;
    max_price: number | null;
    listing_count: number;
    note: string;
  };
  summary: {
    latest_observation_date: string | null;
    observation_count: number;
    official_data_available: boolean;
  };
}

/**
 * Market price insights.
 *
 * Two separate things are shown side by side and never blended: recorded market
 * observations, and the prices farmers have listed on this marketplace. When no
 * official data source is configured the page says so rather than presenting
 * listed prices as if they were mandi rates.
 *
 * Nothing here changes a farmer's price. It is information, and the copy says
 * as much.
 */
export default function FarmerMarketInsights() {
  const { t } = useTranslation();
  useDocumentTitle(t('market.title'));

  const [commodity, setCommodity] = useState('Tomato');
  const [state, setState] = useState('Telangana');
  const [district, setDistrict] = useState('');
  const [applied, setApplied] = useState({ commodity: 'Tomato', state: 'Telangana', district: '' });

  const commodities = useAsync((signal) => marketApi.commodities(signal), []);
  const comparison = useAsync(
    (signal) =>
      api.get<MarketComparisonResponse>(
        '/api/market/compare',
        {
          commodity: applied.commodity,
          state: applied.state,
          ...(applied.district ? { district: applied.district } : {}),
        },
        signal,
      ),
    [applied.commodity, applied.state, applied.district],
  );

  const data = comparison.data;

  // One row per observation plus one summary row for the marketplace itself, so
  // the chart compares like with like.
  const chartData = [
    ...(data?.observations ?? []).map((observation) => ({
      name: observation.market_name ?? observation.source,
      lowest: observation.min_price,
      highest: observation.max_price,
      modal: observation.modal_price,
    })),
    ...(data?.marketplace.average_price != null
      ? [
          {
            name: 'Farmer-listed (avg)',
            lowest: data.marketplace.min_price,
            highest: data.marketplace.max_price,
            modal: data.marketplace.average_price,
          },
        ]
      : []),
  ];

  return (
    <RoleShell role="farmer" title={t('market.title')}>
      <div className="space-y-5">
        <Card>
          <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              name="commodity"
              label={t('market.selectCrop')}
              value={commodity}
              onChange={(event) => setCommodity(event.target.value)}
              options={
                (commodities.data?.commodities ?? []).length > 0
                  ? (commodities.data?.commodities ?? []).map((entry) => ({
                      value: entry.commodity,
                      label: entry.commodity,
                    }))
                  : [{ value: 'Tomato', label: 'Tomato' }]
              }
            />
            <TextInput
              name="state"
              label={t('market.selectState')}
              value={state}
              onChange={(event) => setState(event.target.value)}
            />
            <TextInput
              name="district"
              label={t('market.selectDistrict')}
              value={district}
              onChange={(event) => setDistrict(event.target.value)}
              placeholder={t('common.optional')}
            />
            <div className="flex items-end">
              <Button
                block
                onClick={() => setApplied({ commodity, state, district })}
              >
                {t('common.apply')}
              </Button>
            </div>
          </CardBody>
        </Card>

        {data && !data.configured && (
          <Notice tone="warning" title={t('market.notConfigured')}>
            {t('market.notConfiguredHelp')} {data.sourceNote}
          </Notice>
        )}

        <Notice tone="info" title={t('market.disclosure')}>
          {t('market.cannotAdvise')}
        </Notice>

        {comparison.loading && <Spinner />}
        {!comparison.loading && comparison.error && (
          <ErrorState message={comparison.error} onRetry={comparison.reload} />
        )}

        {data && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardBody>
                  <p className="text-xs font-semibold uppercase text-soil-600">{t('market.marketRange')}</p>
                  <p className="tabular mt-1 text-xl font-bold text-soil-900">
                    {data.observations.length > 0
                      ? `${formatINR(Math.min(...data.observations.map((o) => o.min_price ?? 0)))} – ${formatINR(Math.max(...data.observations.map((o) => o.max_price ?? 0)))}`
                      : t('common.notAvailable')}
                  </p>
                  <p className="text-xs text-soil-500">{data.unit}</p>
                </CardBody>
              </Card>

              <Card>
                <CardBody>
                  <p className="text-xs font-semibold uppercase text-soil-600">
                    {t('market.marketplaceRange')}
                  </p>
                  <p className="tabular mt-1 text-xl font-bold text-soil-900">
                    {data.marketplace.average_price != null
                      ? formatINR(data.marketplace.average_price)
                      : t('common.notAvailable')}
                  </p>
                  <p className="text-xs text-soil-500">
                    {data.marketplace.listing_count} {t('common.results')}
                  </p>
                </CardBody>
              </Card>

              <Card>
                <CardBody>
                  <p className="text-xs font-semibold uppercase text-soil-600">
                    {t('market.priceHistory')}
                  </p>
                  <p className="tabular mt-1 text-xl font-bold text-soil-900">
                    {data.summary.observation_count}
                  </p>
                  <p className="text-xs text-soil-500">{t('market.source')}</p>
                </CardBody>
              </Card>

              <Card>
                <CardBody>
                  <p className="text-xs font-semibold uppercase text-soil-600">
                    {t('market.source')}
                  </p>
                  <p className="mt-1 text-sm font-bold text-soil-900">
                    {data.summary.official_data_available
                      ? t('admin.configured')
                      : t('admin.notConfigured')}
                  </p>
                  <p className="text-xs text-soil-500">
                    {data.summary.latest_observation_date
                      ? `${t('market.observedOn')} ${data.summary.latest_observation_date}`
                      : t('common.noData')}
                  </p>
                </CardBody>
              </Card>
            </div>

            {chartData.length > 0 ? (
              <Card>
                <CardHeader
                  title={t('market.comparison')}
                  subtitle={data.marketplace.note}
                />
                <CardBody>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e7e0d6" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-15} height={60} textAnchor="end" />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(value) => formatINR(Number(value))} />
                        <Legend />
                        <Bar dataKey="lowest" name={t('market.minPrice')} fill="#a3b18a" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="modal" name={t('market.modalPrice')} fill="#588157" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="highest" name={t('market.maxPrice')} fill="#3a5a40" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardBody>
              </Card>
            ) : (
              <EmptyState
                icon={<TrendingUp className="size-6" aria-hidden="true" />}
                title={t('market.noObservations')}
                description={t('market.notConfiguredHelp')}
              />
            )}

            {data.observations.length > 0 && (
              <Card>
                <CardHeader title={t('market.priceHistory')} />
                <CardBody className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-soil-50 text-left text-xs uppercase text-soil-600">
                        <tr>
                          <th className="px-5 py-2.5">{t('market.selectDistrict')}</th>
                          <th className="px-5 py-2.5">{t('market.minPrice')}</th>
                          <th className="px-5 py-2.5">{t('market.modalPrice')}</th>
                          <th className="px-5 py-2.5">{t('market.maxPrice')}</th>
                          <th className="px-5 py-2.5">{t('market.observedOn')}</th>
                          <th className="px-5 py-2.5">{t('market.source')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-soil-100">
                        {data.observations.map((observation) => (
                          <tr key={observation.id}>
                            <td className="px-5 py-2.5 font-medium text-soil-900">
                              {observation.market_name ?? '—'}
                            </td>
                            <td className="tabular px-5 py-2.5">{formatINR(observation.min_price)}</td>
                            <td className="tabular px-5 py-2.5 font-semibold">
                              {formatINR(observation.modal_price)}
                            </td>
                            <td className="tabular px-5 py-2.5">{formatINR(observation.max_price)}</td>
                            <td className="px-5 py-2.5">{observation.observed_on}</td>
                            <td className="px-5 py-2.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span>{observation.source}</span>
                                {observation.freshness === 'stale' && (
                                  <Badge tone="warning">{t('market.stale')}</Badge>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardBody>
              </Card>
            )}

            <p className="flex items-start gap-1.5 text-xs text-soil-500">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {t('market.manualEntryHelp')}
            </p>
          </>
        )}
      </div>
    </RoleShell>
  );
}
