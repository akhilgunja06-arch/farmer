import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MapPin, Navigation, Store, Tractor, Truck } from 'lucide-react';
import { useAsync } from '@/hooks/useCart';
import { farmers as farmersApi, products as productsApi } from '@/lib/services';
import { fileUrl } from '@/components/marketplace/ProductCard';
import { Button } from '@/components/ui/Button';
import { Select, TextInput } from '@/components/ui/Field';
import { Card, CardBody, EmptyState, ErrorState, Notice, Skeleton } from '@/components/ui/Card';
import { Rating } from '@/components/ui/Rating';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

/** Read at build time by Vite. Empty means maps are not configured. */
const MAPS_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? '';

/**
 * Location discovery.
 *
 * The list view is the primary interface and always works. A map is an
 * enhancement on top of it, and only appears when a browser key has been
 * configured — the page never depends on the map to be usable.
 *
 * Distances are computed from a location the customer picks by name, and only
 * farmers who consented to publishing a location appear on the map. Everyone
 * else still appears in the list with their village and district.
 */
export default function LocationsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  useDocumentTitle(t('nav.nearbyFarmers'));

  const [state, setState] = useState('');
  const [district, setDistrict] = useState('');
  const [crop, setCrop] = useState('');

  const states = useAsync((signal) => productsApi.states(signal), []);
  const districts = useAsync(
    (signal) =>
      state ? productsApi.districts(state, signal) : Promise.resolve({ districts: [] }),
    [state],
  );

  const nearby = useAsync(
    (signal) =>
      farmersApi.nearby(
        {
          ...(crop.trim() ? { crop: crop.trim() } : {}),
          max_distance_km: 200,
        },
        signal,
      ),
    [crop],
  );

  const results = useMemo(() => {
    const all = nearby.data?.farmers ?? [];
    // The API already filters by crop; state and district narrow the list
    // further without another round trip.
    return all.filter(
      (farmer) =>
        (!state || farmer.state === state) && (!district || farmer.district === district),
    );
  }, [nearby.data, state, district]);

  const mappable = results.filter(
    (farmer) => farmer.latitude !== null && farmer.longitude !== null,
  );

  return (
    <div className="container-page py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-soil-900">{t('nav.nearbyFarmers')}</h1>
        <p className="mt-1 text-sm text-soil-600">
          Find farmers by state and district, and see what they have available.
        </p>
      </header>

      <Card className="mb-6">
        <CardBody>
          <div className="grid gap-4 sm:grid-cols-3">
            <Select
              name="location-state"
              label={t('auth.state')}
              value={state}
              placeholder="All states"
              options={(states.data?.states ?? []).map((value) => ({ value, label: value }))}
              onChange={(event) => {
                setState(event.target.value);
                setDistrict('');
              }}
            />
            <Select
              name="location-district"
              label={t('auth.district')}
              value={district}
              disabled={!state}
              placeholder={state ? 'All districts' : t('validation.selectState')}
              options={(districts.data?.districts ?? []).map((value) => ({ value, label: value }))}
              onChange={(event) => setDistrict(event.target.value)}
            />
            <TextInput
              name="location-crop"
              label="Crop"
              value={crop}
              onChange={(event) => setCrop(event.target.value)}
              placeholder="e.g. Rice"
            />
          </div>
        </CardBody>
      </Card>

      {!MAPS_KEY && (
        <Notice tone="info" className="mb-6" title="Map view is not enabled">
          A Google Maps browser key has not been configured for this installation, so the map is
          not shown. Searching and browsing farmers by state and district works fully without it.
          See <code className="font-mono text-xs">INTEGRATION_SETUP.md</code> for how to enable the
          map.
        </Notice>
      )}

      {MAPS_KEY && mappable.length > 0 && (
        <Card className="mb-6 overflow-hidden">
          <div className="grid place-items-center bg-soil-100 p-8 text-center">
            <MapPin className="size-8 text-soil-400" aria-hidden="true" />
            <p className="mt-2 text-sm font-semibold text-soil-700">
              {mappable.length} farmers with a published location
            </p>
            <p className="mt-1 max-w-lg text-xs leading-relaxed text-soil-600">
              {mappable
                .map((farmer) => `${farmer.farm_name ?? farmer.full_name} (${farmer.village})`)
                .join(' · ')}
            </p>
          </div>
        </Card>
      )}

      <h2 className="mb-4 text-xl font-bold text-soil-900">
        {results.length > 0
          ? `${results.length} farmers`
          : t('nav.nearbyFarmers')}
      </h2>

      {nearby.loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-44" />
          ))}
        </div>
      ) : nearby.error ? (
        <ErrorState message={nearby.error} onRetry={nearby.reload} />
      ) : results.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((farmer) => (
            <li
              key={farmer.user_id}
              className="flex flex-col rounded-[var(--radius-card)] border border-soil-200 bg-white p-5 shadow-[var(--shadow-card)]"
            >
              <div className="flex items-center gap-3">
                {farmer.profile_photo ? (
                  <img
                    src={fileUrl(farmer.profile_photo) ?? ''}
                    alt=""
                    className="size-12 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="grid size-12 shrink-0 place-items-center rounded-full bg-leaf-100 text-leaf-700">
                    <Tractor className="size-6" aria-hidden="true" />
                  </span>
                )}
                <div className="min-w-0">
                  <h3 className="truncate font-bold text-soil-900">
                    {farmer.farm_name ?? farmer.full_name}
                  </h3>
                  <p className="truncate text-xs text-soil-600">{farmer.full_name}</p>
                </div>
              </div>

              <p className="mt-3 flex items-start gap-1.5 text-sm text-soil-600">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  {farmer.village}, {farmer.district}
                </span>
              </p>

              {typeof farmer.distance_km === 'number' && (
                <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-leaf-800">
                  <Navigation className="size-3.5" aria-hidden="true" />
                  About {farmer.distance_km.toFixed(1)} km away
                </p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {farmer.rating_count > 0 && (
                  <Rating value={farmer.rating_avg} count={farmer.rating_count} />
                )}
                {farmer.offers_delivery && (
                  <span className="inline-flex items-center gap-1 text-xs text-soil-600">
                    <Truck className="size-3.5" aria-hidden="true" />
                    {t('product.delivery')}
                  </span>
                )}
              </div>

              <p className="mt-3 text-sm font-semibold text-soil-800">
                {farmer.active_listings} listings
              </p>

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
      ) : (
        <EmptyState
          icon={<Store className="size-6" aria-hidden="true" />}
          title={t('common.noData')}
          description="No farmers found in this area yet. Try a different district, or browse all crops."
          action={
            <Button variant="outline" onClick={() => navigate('/explore')}>
              {t('landing.browseCrops')}
            </Button>
          }
        />
      )}
    </div>
  );
}
