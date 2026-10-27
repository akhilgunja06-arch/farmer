import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal, X } from 'lucide-react';
import { useAsync, useDebounced } from '@/hooks/useCart';
import { products as productsApi } from '@/lib/services';
import { ProductCard } from '@/components/marketplace/ProductCard';
import { Button } from '@/components/ui/Button';
import { Checkbox, Select, TextInput } from '@/components/ui/Field';
import { EmptyState, ErrorState, ProductGridSkeleton } from '@/components/ui/Card';
import { Pagination } from '@/components/ui/Pagination';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { cn } from '@/lib/cn';

const PAGE_SIZE = 12;

/**
 * The catalogue.
 *
 * Filter state lives in the URL, so a filtered view can be shared, bookmarked,
 * and survives the back button. It also means the search box on the landing
 * page and this page share one representation of a query.
 */
export default function ExplorePage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  useDocumentTitle(t('nav.explore'));

  const [searchInput, setSearchInput] = useState(params.get('search') ?? '');
  const debouncedSearch = useDebounced(searchInput);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Push the debounced search into the URL so typing does not spam the API.
  useEffect(() => {
    const current = params.get('search') ?? '';
    if (debouncedSearch === current) return;
    const next = new URLSearchParams(params);
    if (debouncedSearch) next.set('search', debouncedSearch);
    else next.delete('search');
    next.delete('page');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const query = useMemo(() => {
    const read = (key: string) => params.get(key) ?? undefined;
    const readNumber = (key: string) => {
      const value = params.get(key);
      return value ? Number(value) : undefined;
    };
    return {
      search: read('search'),
      category: read('category'),
      state: read('state'),
      district: read('district'),
      variety: read('variety'),
      grade: read('grade'),
      min_price: readNumber('min_price'),
      max_price: readNumber('max_price'),
      offers_delivery: params.get('offers_delivery') === '1' ? true : undefined,
      offers_pickup: params.get('offers_pickup') === '1' ? true : undefined,
      verified_farmers_only: params.get('verified_farmers_only') === '1' ? true : undefined,
      sort: read('sort') ?? 'recent',
      page: Number(params.get('page') ?? 1),
      page_size: PAGE_SIZE,
    };
  }, [params]);

  const results = useAsync((signal) => productsApi.list(query, signal), [JSON.stringify(query)]);
  const categories = useAsync((signal) => productsApi.categories(signal), []);
  const states = useAsync((signal) => productsApi.states(signal), []);
  const districts = useAsync(
    (signal) =>
      query.state
        ? productsApi.districts(query.state, signal)
        : Promise.resolve({ districts: [] }),
    [query.state],
  );

  const updateParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    // Any filter change invalidates the current page number.
    if (key !== 'page') next.delete('page');
    setParams(next);
  };

  const activeFilterCount = [
    'category',
    'state',
    'district',
    'variety',
    'grade',
    'min_price',
    'max_price',
    'offers_delivery',
    'offers_pickup',
    'verified_farmers_only',
  ].filter((key) => params.get(key)).length;

  const clearFilters = () => {
    const next = new URLSearchParams();
    if (searchInput) next.set('search', searchInput);
    if (params.get('sort')) next.set('sort', params.get('sort')!);
    setParams(next);
  };

  const sortOptions = [
    { value: 'recent', label: 'Recently listed' },
    { value: 'price_asc', label: 'Price: low to high' },
    { value: 'price_desc', label: 'Price: high to low' },
    { value: 'harvest_desc', label: 'Harvest date: newest' },
    { value: 'rating_desc', label: 'Highest-rated seller' },
    { value: 'popular', label: 'Most viewed' },
  ];

  const filterPanel = (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-sm font-bold text-soil-900">{t('auth.state')}</h3>
        <Select
          name="filter-state"
          value={query.state ?? ''}
          placeholder="All states"
          options={(states.data?.states ?? []).map((value) => ({ value, label: value }))}
          onChange={(event) => {
            updateParam('state', event.target.value || undefined);
            updateParam('district', undefined);
          }}
        />
      </div>

      {query.state && (
        <div>
          <h3 className="mb-2 text-sm font-bold text-soil-900">{t('auth.district')}</h3>
          <Select
            name="filter-district"
            value={query.district ?? ''}
            placeholder="All districts"
            options={(districts.data?.districts ?? []).map((value) => ({ value, label: value }))}
            onChange={(event) => updateParam('district', event.target.value || undefined)}
          />
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-bold text-soil-900">{t('farmer.category')}</h3>
        <Select
          name="filter-category"
          value={query.category ?? ''}
          placeholder="All categories"
          options={(categories.data?.categories ?? []).map((category) => ({
            value: String(category.id),
            label: category.name,
          }))}
          onChange={(event) => updateParam('category', event.target.value || undefined)}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-bold text-soil-900">{t('farmer.grade')}</h3>
        <Select
          name="filter-grade"
          value={query.grade ?? ''}
          placeholder="Any grade"
          options={[
            { value: 'A', label: t('product.gradeA') },
            { value: 'B', label: t('product.gradeB') },
            { value: 'C', label: t('product.gradeC') },
            { value: 'ungraded', label: t('product.gradeUngraded') },
          ]}
          onChange={(event) => updateParam('grade', event.target.value || undefined)}
        />
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-bold text-soil-900">{t('farmer.pricing')}</legend>
        <div className="grid grid-cols-2 gap-3">
          <TextInput
            name="min_price"
            type="number"
            inputMode="numeric"
            min={0}
            label={t('market.minPrice')}
            defaultValue={query.min_price ?? ''}
            onBlur={(event) => updateParam('min_price', event.target.value || undefined)}
          />
          <TextInput
            name="max_price"
            type="number"
            inputMode="numeric"
            min={0}
            label={t('market.maxPrice')}
            defaultValue={query.max_price ?? ''}
            onBlur={(event) => updateParam('max_price', event.target.value || undefined)}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-2.5">
        <legend className="mb-2 text-sm font-bold text-soil-900">
          {t('customer.deliveryMethod')}
        </legend>
        <Checkbox
          name="offers_delivery"
          label={t('product.delivery')}
          checked={params.get('offers_delivery') === '1'}
          onChange={(event) =>
            updateParam('offers_delivery', event.target.checked ? '1' : undefined)
          }
        />
        <Checkbox
          name="offers_pickup"
          label={t('product.pickup')}
          checked={params.get('offers_pickup') === '1'}
          onChange={(event) => updateParam('offers_pickup', event.target.checked ? '1' : undefined)}
        />
        <Checkbox
          name="verified_farmers_only"
          label={t('product.verified')}
          checked={params.get('verified_farmers_only') === '1'}
          onChange={(event) =>
            updateParam('verified_farmers_only', event.target.checked ? '1' : undefined)
          }
        />
      </fieldset>

      <div>
        <h3 className="mb-2 text-sm font-bold text-soil-900">{t('farmer.variety')}</h3>
        <TextInput
          name="variety"
          defaultValue={query.variety ?? ''}
          placeholder="e.g. Sona Masuri"
          onBlur={(event) => updateParam('variety', event.target.value || undefined)}
        />
      </div>

      {activeFilterCount > 0 && (
        <Button variant="outline" block onClick={clearFilters}>
          <X className="size-4" aria-hidden="true" />
          {t('common.clearAll')} ({activeFilterCount})
        </Button>
      )}
    </div>
  );

  return (
    <div className="container-page py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-soil-900">{t('nav.explore')}</h1>
        <p className="mt-1 text-sm text-soil-600">
          {t('landing.heroSubtitle')}
        </p>
      </header>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <TextInput
            name="explore-search"
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t('landing.searchPlaceholder')}
            aria-label={t('common.search')}
          />
        </div>

        <Select
          name="explore-sort"
          value={query.sort}
          options={sortOptions}
          onChange={(event) => updateParam('sort', event.target.value)}
          wrapperClassName="sm:w-56"
        />

        <Button
          variant="outline"
          onClick={() => setFiltersOpen((open) => !open)}
          className="lg:hidden"
          aria-expanded={filtersOpen}
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          {t('common.filters')}
          {activeFilterCount > 0 && (
            <span className="ml-1 rounded-full bg-leaf-700 px-1.5 text-xs text-white">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[17rem_1fr]">
        <aside className={cn('lg:block', filtersOpen ? 'block' : 'hidden')}>
          <div className="rounded-[var(--radius-card)] border border-soil-200 bg-white p-5 lg:sticky lg:top-20">
            <h2 className="mb-4 flex items-center gap-2 font-bold text-soil-900">
              <SlidersHorizontal className="size-4" aria-hidden="true" />
              {t('common.filters')}
            </h2>
            {filterPanel}
          </div>
        </aside>

        <div className="min-w-0">
          {results.loading ? (
            <ProductGridSkeleton count={9} />
          ) : results.error ? (
            <ErrorState message={results.error} onRetry={results.reload} />
          ) : results.data && results.data.items.length > 0 ? (
            <>
              <p className="mb-3 text-sm text-soil-600">
                {t('common.showing')} {results.data.items.length} {t('common.of')}{' '}
                <span className="tabular font-semibold">{results.data.total}</span>{' '}
                {t('common.results')}
              </p>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {results.data.items.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>

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
              title={t('common.noData')}
              description={
                activeFilterCount > 0 || query.search
                  ? 'No crops match these filters. Try widening your search.'
                  : 'No crops have been listed yet. Please check back soon.'
              }
              action={
                activeFilterCount > 0 ? (
                  <Button variant="outline" onClick={clearFilters}>
                    {t('common.clearAll')}
                  </Button>
                ) : undefined
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
