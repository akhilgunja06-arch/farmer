import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MapPin, ShieldCheck, Store, Tractor } from 'lucide-react';
import { useAsync, useDebounced } from '@/hooks/useCart';
import { farmers as farmersApi, products as productsApi } from '@/lib/services';
import { fileUrl } from '@/components/marketplace/ProductCard';
import { Button } from '@/components/ui/Button';
import { Select, TextInput } from '@/components/ui/Field';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Card';
import { Pagination } from '@/components/ui/Pagination';
import { Rating } from '@/components/ui/Rating';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { formatDate } from '@/lib/format';

/** The farmer directory: who is selling, and where. */
export default function FarmersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  useDocumentTitle(t('nav.nearbyFarmers'));
  const [params, setParams] = useSearchParams();

  const [searchInput, setSearchInput] = useState(params.get('search') ?? '');
  const debouncedSearch = useDebounced(searchInput);

  const query = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      state: params.get('state') ?? undefined,
      district: params.get('district') ?? undefined,
      verified_only: params.get('verified_only') === '1' ? true : undefined,
      sort: params.get('sort') ?? 'rating_desc',
      page: Number(params.get('page') ?? 1),
      page_size: 12,
    }),
    [debouncedSearch, params],
  );

  const results = useAsync((signal) => farmersApi.list(query, signal), [JSON.stringify(query)]);
  const states = useAsync((signal) => productsApi.states(signal), []);
  const districts = useAsync(
    (signal) =>
      query.state ? productsApi.districts(query.state, signal) : Promise.resolve({ districts: [] }),
    [query.state],
  );

  const updateParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  };

  return (
    <div className="container-page py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-soil-900">{t('nav.nearbyFarmers')}</h1>
        <p className="mt-1 text-sm text-soil-600">{t('landing.farmersNearYouSub')}</p>
      </header>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <TextInput
            name="farmer-search"
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search by farm name, farmer, or crop"
            aria-label={t('common.search')}
          />
        </div>
        <Select
          name="farmer-state"
          value={query.state ?? ''}
          placeholder="All states"
          options={(states.data?.states ?? []).map((value) => ({ value, label: value }))}
          onChange={(event) => {
            updateParam('state', event.target.value || undefined);
            updateParam('district', undefined);
          }}
          wrapperClassName="sm:w-48"
        />
        {query.state && (
          <Select
            name="farmer-district"
            value={query.district ?? ''}
            placeholder="All districts"
            options={(districts.data?.districts ?? []).map((value) => ({ value, label: value }))}
            onChange={(event) => updateParam('district', event.target.value || undefined)}
            wrapperClassName="sm:w-48"
          />
        )}
        <Select
          name="farmer-sort"
          value={query.sort}
          options={[
            { value: 'rating_desc', label: 'Highest rated' },
            { value: 'listings_desc', label: 'Most listings' },
            { value: 'recent', label: 'Recently joined' },
          ]}
          onChange={(event) => updateParam('sort', event.target.value)}
          wrapperClassName="sm:w-48"
        />
      </div>

      {results.loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-52" />
          ))}
        </div>
      ) : results.error ? (
        <ErrorState message={results.error} onRetry={results.reload} />
      ) : results.data && results.data.items.length > 0 ? (
        <>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {results.data.items.map((farmer) => (
              <li
                key={farmer.user_id}
                className="flex flex-col rounded-[var(--radius-card)] border border-soil-200 bg-white p-5 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-lifted)]"
              >
                <div className="flex items-center gap-3">
                  {farmer.profile_photo ? (
                    <img
                      src={fileUrl(farmer.profile_photo) ?? ''}
                      alt=""
                      className="size-14 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <span className="grid size-14 shrink-0 place-items-center rounded-full bg-leaf-100 text-leaf-700">
                      <Tractor className="size-7" aria-hidden="true" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <h2 className="truncate font-bold text-soil-900">
                      {farmer.farm_name ?? farmer.full_name}
                    </h2>
                    <p className="truncate text-sm text-soil-600">{farmer.full_name}</p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {farmer.verification_status === 'verified' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-leaf-50 px-2 py-0.5 text-xs font-semibold text-leaf-800 ring-1 ring-inset ring-leaf-200">
                      <ShieldCheck className="size-3.5" aria-hidden="true" />
                      {t('product.verified')}
                    </span>
                  )}
                  {farmer.rating_count > 0 && (
                    <Rating value={farmer.rating_avg} count={farmer.rating_count} />
                  )}
                </div>

                <p className="mt-3 flex items-start gap-1.5 text-sm text-soil-600">
                  <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    {farmer.village}, {farmer.district}, {farmer.state}
                    {typeof farmer.distance_km === 'number' && (
                      <span className="ml-1 font-semibold text-leaf-800">
                        ({farmer.distance_km.toFixed(1)} km)
                      </span>
                    )}
                  </span>
                </p>

                {farmer.crops_cultivated && farmer.crops_cultivated.length > 0 && (
                  <p className="mt-2 line-clamp-1 text-xs text-soil-500">
                    {farmer.crops_cultivated.slice(0, 4).join(' · ')}
                  </p>
                )}

                <p className="mt-3 text-sm font-semibold text-soil-800">
                  {farmer.active_listings} listings
                </p>
                <p className="text-xs text-soil-500">Joined {formatDate(farmer.created_at)}</p>

                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => navigate(`/farmers/${farmer.user_id}`)}
                >
                  {t('common.viewDetails')}
                </Button>
              </li>
            ))}
          </ul>

          <div className="mt-8">
            <Pagination
              page={results.data.page}
              totalPages={results.data.total_pages}
              onPageChange={(page) => {
                updateParam('page', String(page));
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
          </div>
        </>
      ) : (
        <EmptyState
          icon={<Store className="size-6" aria-hidden="true" />}
          title={t('common.noData')}
          description="No farmers match this search yet."
          action={
            <Link to="/explore" className="font-semibold text-leaf-700 underline">
              {t('landing.browseCrops')}
            </Link>
          }
        />
      )}
    </div>
  );
}
