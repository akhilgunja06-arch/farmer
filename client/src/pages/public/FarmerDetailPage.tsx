import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, MapPin, Sprout, Truck } from 'lucide-react';
import { useAsync } from '@/hooks/useCart';
import { farmers as farmersApi } from '@/lib/services';
import { fileUrl } from '@/components/marketplace/ProductCard';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, EmptyState, ErrorState, Notice, Spinner } from '@/components/ui/Card';
import { Badge, VerificationBadge } from '@/components/ui/Badge';
import { ProductCard } from '@/components/marketplace/ProductCard';
import { Rating } from '@/components/ui/Rating';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { formatDate } from '@/lib/format';
import type { FarmerSummary, ProductSummary } from '@/lib/types';

interface FarmerDetail {
  farmer: FarmerSummary;
  products: ProductSummary[];
}

/**
 * One farm, publicly.
 *
 * Only what the farmer agreed to publish is shown — the API returns the
 * coordinates as null unless consent was given, so the map link simply does not
 * appear rather than showing an approximate location.
 */
export default function FarmerDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const result = useAsync(
    (signal) => farmersApi.detail(id, signal) as Promise<FarmerDetail>,
    [id],
  );
  const farmer = result.data?.farmer ?? null;
  useDocumentTitle(farmer?.farm_name ?? farmer?.full_name ?? t('product.farmer'));

  if (result.loading) {
    return (
      <div className="container-page py-10">
        <Spinner />
      </div>
    );
  }

  if (result.error || !farmer) {
    return (
      <div className="container-page py-10">
        <ErrorState message={result.error ?? t('common.notFound')} onRetry={result.reload} />
      </div>
    );
  }

  const products = result.data?.products ?? [];
  const photo = fileUrl(farmer.profile_photo);
  const hasLocation = farmer.latitude !== null && farmer.longitude !== null;

  return (
    <div className="container-page space-y-6 py-8">
      <Button variant="ghost" size="sm" onClick={() => navigate('/farmers')}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('nav.nearbyFarmers')}
      </Button>

      <Card>
        <CardBody className="flex flex-wrap items-start gap-5">
          <div className="size-20 shrink-0 overflow-hidden rounded-full bg-soil-100">
            {photo ? (
              <img src={photo} alt="" className="size-full object-cover" />
            ) : (
              <span className="grid size-full place-items-center text-soil-400">
                <Sprout className="size-8" aria-hidden="true" />
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-soil-900">
                {farmer.farm_name ?? farmer.full_name}
              </h1>
              <VerificationBadge status={farmer.verification_status} />
            </div>

            {farmer.farm_name && (
              <p className="text-sm text-soil-600">{farmer.full_name}</p>
            )}

            <p className="mt-1 flex items-center gap-1.5 text-sm text-soil-600">
              <MapPin className="size-3.5" aria-hidden="true" />
              {farmer.village}, {farmer.district}, {farmer.state}
              {typeof farmer.distance_km === 'number' && (
                <span className="text-soil-500"> · {farmer.distance_km.toFixed(0)} km</span>
              )}
            </p>

            {farmer.rating_count > 0 && (
              <div className="mt-2">
                <Rating value={farmer.rating_avg} count={farmer.rating_count} size="md" />
              </div>
            )}

            {farmer.bio && <p className="mt-3 text-sm leading-relaxed text-soil-700">{farmer.bio}</p>}

            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone="neutral">
                {farmer.active_listings} {t('landing.statsProducts')}
              </Badge>
              {farmer.offers_delivery && (
                <Badge tone="info" icon={<Truck className="size-3.5" aria-hidden="true" />}>
                  {t('product.delivery')}
                </Badge>
              )}
              {farmer.offers_pickup && <Badge tone="neutral">{t('product.pickup')}</Badge>}
              <Badge tone="neutral">
                {t('common.of')} {formatDate(farmer.created_at)}
              </Badge>
            </div>
          </div>
        </CardBody>
      </Card>

      {!hasLocation && (
        <Notice tone="info">{t('quality.distinctNote')}</Notice>
      )}

      {(farmer.crops_cultivated?.length ?? 0) > 0 && (
        <Card>
          <CardHeader title={t('auth.cropsCultivated')} />
          <CardBody className="flex flex-wrap gap-2">
            {(farmer.crops_cultivated ?? []).map((crop) => (
              <Badge key={crop} tone="leaf">
                {crop}
              </Badge>
            ))}
          </CardBody>
        </Card>
      )}

      <section>
        <h2 className="mb-4 text-lg font-bold text-soil-900">{t('landing.freshListings')}</h2>
        {products.length === 0 ? (
          <EmptyState
            icon={<Sprout className="size-6" aria-hidden="true" />}
            title={t('farmer.noListings')}
            description={t('common.noData')}
            action={<Button onClick={() => navigate('/explore')}>{t('landing.browseCrops')}</Button>}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {products.map((product) => (
              <Link key={product.id} to={`/products/${product.id}`}>
                <ProductCard product={product} />
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
