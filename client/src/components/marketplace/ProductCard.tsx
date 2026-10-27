import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MapPin, ShieldCheck, Store, Truck } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatINR, formatQuantity, formatDate, unitLabel, gradeLabelKey } from '@/lib/format';
import type { ProductSummary } from '@/lib/types';
import { Badge, GradeBadge } from '@/components/ui/Badge';
import { Rating } from '@/components/ui/Rating';

/** The image URL for a stored file path. */
export function fileUrl(path: string | null): string | null {
  if (!path) return null;
  // Already an absolute URL (e.g. a CDN in a future deployment).
  if (path.startsWith('http')) return path;
  return `/api/files/${path.replace(/^\/+/, '')}`;
}

/**
 * A product card.
 *
 * Shows the price, the unit and the quantity available, because those are the
 * three things a buyer needs before clicking. An absent image gets a labelled
 * placeholder rather than a broken frame.
 */
export function ProductCard({ product }: { product: ProductSummary }) {
  const { t } = useTranslation();
  const image = fileUrl(product.primary_image);
  const unit = unitLabel(product.unit, product.custom_unit);
  const outOfStock = product.stock_quantity <= 0;

  // Prefer the product's own rating; fall back to the farmer's. `!= null` is
  // deliberate — the API omits these fields when there are no reviews, so they
  // arrive as undefined and a strict null check would let undefined through.
  const hasProductRating = (product.rating_count ?? 0) > 0;
  const ratingValue = hasProductRating ? product.rating_avg : product.farmer_rating_avg;
  const ratingCount = hasProductRating ? product.rating_count : product.farmer_rating_count;
  // A product nobody has reviewed yet reports 0, which would render as a
  // literal "0.0" and read as a one-star-and-below score. Show nothing instead.
  const showRating = (ratingCount ?? 0) > 0 && ratingValue != null;

  return (
    <article className="group flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-soil-200 bg-white shadow-[var(--shadow-card)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lifted)]">
      <Link
        to={`/products/${product.id}`}
        className="relative block aspect-[4/3] overflow-hidden bg-soil-100"
        aria-label={product.name}
      >
        {image ? (
          <img
            src={image}
            alt={product.name}
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="grid size-full place-items-center text-soil-400">
            <Store className="size-10" aria-hidden="true" />
          </div>
        )}

        <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
          {product.grade !== 'ungraded' && <GradeBadge grade={product.grade} />}
          {outOfStock && <Badge tone="danger">{t('product.outOfStock')}</Badge>}
        </div>

        {product.farmer_verification_status === 'verified' && (
          <span
            className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-[0.65rem] font-bold text-leaf-800 shadow-sm"
            title={t('product.verified')}
          >
            <ShieldCheck className="size-3" aria-hidden="true" />
            {t('product.verified')}
          </span>
        )}
      </Link>

      <div className="flex flex-1 flex-col p-3.5">
        <h3 className="line-clamp-1 font-bold text-soil-900">
          <Link to={`/products/${product.id}`} className="hover:text-leaf-800">
            {product.name}
          </Link>
        </h3>

        {product.variety && (
          <p className="line-clamp-1 text-xs text-soil-600">{product.variety}</p>
        )}

        <p className="mt-1.5 flex items-center gap-1 text-xs text-soil-600">
          <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {product.village}, {product.district}
          </span>
          {typeof product.distance_km === 'number' && (
            <span className="shrink-0 font-semibold text-leaf-800">
              · {product.distance_km.toFixed(1)} km
            </span>
          )}
        </p>

        <p className="mt-1 text-xs text-soil-500">
          {t('product.soldBy', { name: product.farmer_name })}
        </p>

        {showRating && (
          <div className="mt-1.5">
            <Rating value={ratingValue} count={ratingCount} />
          </div>
        )}

        <div className="mt-auto pt-3">
          <p className="flex items-baseline gap-1">
            <span className="tabular text-lg font-bold text-soil-900">
              {formatINR(product.price)}
            </span>
            <span className="text-xs text-soil-600">
              {t('product.perUnit', { unit })}
            </span>
          </p>

          <p className="tabular mt-0.5 text-xs text-soil-600">
            {outOfStock
              ? t('product.outOfStock')
              : t('product.available', {
                  quantity: formatQuantity(product.stock_quantity),
                  unit,
                })}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {product.offers_delivery && (
              <span className="inline-flex items-center gap-1 text-[0.7rem] font-medium text-soil-600">
                <Truck className="size-3.5" aria-hidden="true" />
                {t('product.delivery')}
              </span>
            )}
            {product.harvest_date && (
              <span className="text-[0.7rem] text-soil-500">
                · {t('product.harvestDate')} {formatDate(product.harvest_date)}
              </span>
            )}
          </div>

          {product.price_negotiable && (
            <p className="mt-1 text-[0.7rem] font-semibold text-sun-600">
              {t('product.negotiable')}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

/** Compact horizontal variant, used in cart-adjacent and saved lists. */
export function ProductRow({
  product,
  action,
  className,
}: {
  product: ProductSummary;
  action?: React.ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const image = fileUrl(product.primary_image);
  const unit = unitLabel(product.unit, product.custom_unit);

  return (
    <div className={cn('flex gap-3 rounded-[var(--radius-card)] border border-soil-200 bg-white p-3', className)}>
      <Link to={`/products/${product.id}`} className="size-20 shrink-0 overflow-hidden rounded-lg bg-soil-100">
        {image ? (
          <img src={image} alt={product.name} loading="lazy" className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center text-soil-400">
            <Store className="size-6" aria-hidden="true" />
          </div>
        )}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="line-clamp-1 text-sm font-bold text-soil-900">
          <Link to={`/products/${product.id}`} className="hover:text-leaf-800">
            {product.name}
          </Link>
        </h3>
        <p className="text-xs text-soil-600">{product.farmer_name}</p>
        <p className="tabular mt-1 text-sm font-bold text-soil-900">
          {formatINR(product.price)}{' '}
          <span className="text-xs font-normal text-soil-600">
            {t('product.perUnit', { unit })}
          </span>
        </p>
        <p className="text-xs text-soil-500">{t(gradeLabelKey(product.grade))}</p>
      </div>

      {action && <div className="flex shrink-0 flex-col justify-center gap-2">{action}</div>}
    </div>
  );
}
