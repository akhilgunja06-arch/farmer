import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  FileText,
  Info,
  MapPin,
  MessageSquare,
  Minus,
  Package,
  Plus,
  ShieldCheck,
  ShoppingCart,
  Store,
  Truck,
} from 'lucide-react';
import { useAsync, bumpCartCount } from '@/hooks/useCart';
import {
  products as productsApi,
  cart as cartApi,
  messages as messagesApi,
  saved as savedApi,
} from '@/lib/services';
import { fileUrl } from '@/components/marketplace/ProductCard';
import { formatINR, formatQuantity, formatDate, unitLabel, gradeLabelKey } from '@/lib/format';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError, messageOf } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Badge, GradeBadge, VerificationBadge, AiAssessmentBadge } from '@/components/ui/Badge';
import { Card, CardBody, ErrorState, Notice, Spinner } from '@/components/ui/Card';
import { Rating } from '@/components/ui/Rating';
import { TextArea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { quality as qualityApi } from '@/lib/services';
import { cn } from '@/lib/cn';
import type { ProductDetail, ProductReview, QualityReport } from '@/lib/types';

/**
 * The product detail page.
 *
 * The stock figure shown here is the live figure from the database. Adding more
 * than that to the cart is refused by the server, and this page also refuses it
 * locally so the user finds out before the round trip.
 */
export default function ProductDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, isCustomer } = useAuth();

  const result = useAsync((signal) => productsApi.detail(id, signal), [id]);
  const product = result.data?.product ?? null;
  const isOwner = result.data?.is_owner ?? false;

  useDocumentTitle(product?.name ?? '');

  const [activeImage, setActiveImage] = useState(0);
  const [quantity, setQuantity] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [cartMessage, setCartMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [saved, setSaved] = useState<boolean | null>(null);
  const [savingToList, setSavingToList] = useState(false);

  if (result.loading) {
    return (
      <div className="container-page py-16">
        <Spinner label={t('common.loading')} />
      </div>
    );
  }

  if (result.error) {
    return (
      <div className="container-page py-16">
        <ErrorState
          title="We could not load this crop"
          message={result.error}
          onRetry={result.reload}
        />
        <div className="mt-6 text-center">
          <Button variant="outline" onClick={() => navigate('/explore')}>
            {t('landing.browseCrops')}
          </Button>
        </div>
      </div>
    );
  }

  if (!product) return null;

  const unit = unitLabel(product.unit, product.custom_unit);
  const images = product.images ?? [];
  const current = images[activeImage];
  const outOfStock = product.stock_quantity <= 0;
  const minOrder = product.minimum_order_quantity;
  const chosen = quantity ?? minOrder;
  const bulkApplies =
    product.bulk_min_quantity !== null &&
    product.bulk_price_per_unit !== null &&
    chosen >= product.bulk_min_quantity;
  const effectivePrice = bulkApplies ? product.bulk_price_per_unit! : product.price;
  const lineTotal = Math.round(effectivePrice * chosen * 100) / 100;

  const addToCart = async () => {
    setCartMessage(null);

    if (!user) {
      navigate('/auth/choose-role', { state: { from: `/products/${id}` } });
      return;
    }
    if (!isCustomer) {
      setCartMessage({
        tone: 'danger',
        text: 'Only customer accounts can place orders. You are signed in as a farmer.',
      });
      return;
    }

    setAdding(true);
    try {
      await cartApi.add(product.id, chosen);
      bumpCartCount();
      setCartMessage({
        tone: 'success',
        text: `${formatQuantity(chosen)} ${unit} added to your cart.`,
      });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'INSUFFICIENT_STOCK') {
        setCartMessage({
          tone: 'danger',
          text: `Only ${formatQuantity(product.stock_quantity)} ${unit} are available. Please reduce the quantity.`,
        });
      } else {
        setCartMessage({ tone: 'danger', text: messageOf(caught) });
      }
    } finally {
      setAdding(false);
    }
  };

  const toggleSaved = async () => {
    if (!user) {
      navigate('/auth/choose-role', { state: { from: `/products/${id}` } });
      return;
    }
    setSavingToList(true);
    try {
      if (saved) {
        await savedApi.remove(product.id);
        setSaved(false);
      } else {
        await savedApi.add(product.id);
        setSaved(true);
      }
    } catch (caught) {
      setCartMessage({ tone: 'danger', text: messageOf(caught) });
    } finally {
      setSavingToList(false);
    }
  };

  const buyNow = async () => {
    await addToCart();
    if (isCustomer) navigate('/customer/cart');
  };

  return (
    <div className="container-page py-6">
      <nav className="mb-5 text-sm text-soil-600" aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link to="/" className="hover:text-leaf-800 hover:underline">
              {t('nav.home')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link to="/explore" className="hover:text-leaf-800 hover:underline">
              {t('nav.explore')}
            </Link>
          </li>
          {product.category_name && (
            <>
              <li aria-hidden="true">/</li>
              <li>
                <Link
                  to={`/explore?category=${product.category_id}`}
                  className="hover:text-leaf-800 hover:underline"
                >
                  {product.category_name}
                </Link>
              </li>
            </>
          )}
          <li aria-hidden="true">/</li>
          <li className="font-semibold text-soil-800">{product.name}</li>
        </ol>
      </nav>

      {isOwner && (
        <Notice tone="info" className="mb-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              This is your own listing.
              {product.status && product.status !== 'active' && ' It is not published yet.'}
            </span>
            <Button size="sm" variant="outline" onClick={() => navigate(`/farmer/products/${product.id}/edit`)}>
              {t('common.edit')}
            </Button>
          </div>
        </Notice>
      )}

      <div className="grid gap-8 lg:grid-cols-[1.15fr_1fr]">
        {/* ------------------------------------------------------- gallery */}
        <div>
          <div className="relative aspect-[4/3] overflow-hidden rounded-[var(--radius-card)] border border-soil-200 bg-soil-100">
            {current ? (
              <img
                src={fileUrl(current.storage_path) ?? ''}
                alt={current.caption ?? product.name}
                className="size-full object-cover"
              />
            ) : (
              <div className="grid size-full place-items-center text-soil-400">
                <Store className="size-16" aria-hidden="true" />
              </div>
            )}

            {images.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => setActiveImage((index) => (index - 1 + images.length) % images.length)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 shadow-sm hover:bg-white"
                  aria-label={t('common.previous')}
                >
                  <ChevronLeft className="size-5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveImage((index) => (index + 1) % images.length)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 shadow-sm hover:bg-white"
                  aria-label={t('common.next')}
                >
                  <ChevronRight className="size-5" aria-hidden="true" />
                </button>
              </>
            )}
          </div>

          {images.length > 1 && (
            <ul className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {images.map((image, index) => (
                <li key={image.id}>
                  <button
                    type="button"
                    onClick={() => setActiveImage(index)}
                    aria-label={`${t('common.page')} ${index + 1}`}
                    aria-current={index === activeImage}
                    className={cn(
                      'size-16 shrink-0 overflow-hidden rounded-lg border-2',
                      index === activeImage ? 'border-leaf-600' : 'border-transparent',
                    )}
                  >
                    <img
                      src={fileUrl(image.storage_path) ?? ''}
                      alt=""
                      className="size-full object-cover"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* --------------------------------------------- description etc */}
          <Card className="mt-6">
            <CardBody>
              <h2 className="text-lg font-bold text-soil-900">{t('product.description')}</h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-soil-700">
                {product.description || t('common.notProvided')}
              </p>
              {product.description && (
                <p className="mt-2 text-xs text-soil-500">
                  Written by the farmer. Product descriptions are shown in the language they were
                  written in.
                </p>
              )}
            </CardBody>
          </Card>

          <QualitySection product={product} />

          <ReviewsSection reviews={product.reviews ?? []} />

          {product.similar && product.similar.length > 0 && (
            <section className="mt-6" aria-labelledby="similar">
              <h2 id="similar" className="mb-3 text-lg font-bold text-soil-900">
                {t('product.similar')}
              </h2>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {product.similar.map((item) => (
                  <li key={item.id}>
                    <Link
                      to={`/products/${item.id}`}
                      className="flex flex-col rounded-[var(--radius-card)] border border-soil-200 bg-white p-3 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)]"
                    >
                      <span className="mb-2 block aspect-[4/3] overflow-hidden rounded-lg bg-soil-100">
                        {item.primary_image ? (
                          <img
                            src={fileUrl(item.primary_image) ?? ''}
                            alt=""
                            className="size-full object-cover"
                          />
                        ) : (
                          <span className="grid size-full place-items-center text-soil-400">
                            <Store className="size-6" aria-hidden="true" />
                          </span>
                        )}
                      </span>
                      <span className="line-clamp-1 text-sm font-semibold text-soil-900">
                        {item.name}
                      </span>
                      <span className="tabular mt-0.5 text-sm font-bold text-soil-900">
                        {formatINR(item.price)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* ---------------------------------------------------- buy panel */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardBody>
              <div className="flex flex-wrap items-center gap-2">
                {product.grade !== 'ungraded' && <GradeBadge grade={product.grade} />}
                {product.farmer_verification_status === 'verified' && (
                  <VerificationBadge status="verified" />
                )}
                {product.organic_certified && (
                  <Badge tone="success" icon={<ShieldCheck className="size-3.5" aria-hidden="true" />}>
                    {t('farmer.organicCertified')}
                  </Badge>
                )}
              </div>

              <h1 className="mt-3 text-2xl font-bold text-soil-900">{product.name}</h1>
              {product.variety && <p className="mt-0.5 text-sm text-soil-600">{product.variety}</p>}

              <p className="mt-3 flex items-start gap-1.5 text-sm text-soil-600">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  {product.village}, {product.district}, {product.state}
                  {typeof product.distance_km === 'number' && (
                    <span className="ml-1 font-semibold text-leaf-800">
                      ({product.distance_km.toFixed(1)} km away)
                    </span>
                  )}
                </span>
              </p>

              <div className="mt-4 rounded-[var(--radius-control)] bg-rice-100 p-4">
                <p className="flex items-baseline gap-1.5">
                  <span className="tabular text-3xl font-bold text-soil-900">
                    {formatINR(product.price)}
                  </span>
                  <span className="text-sm text-soil-600">
                    {t('product.perUnit', { unit })}
                  </span>
                </p>

                {product.price_negotiable && (
                  <p className="mt-1 text-sm font-semibold text-sun-600">
                    {t('product.negotiable')} — message the farmer to discuss
                  </p>
                )}

                {product.bulk_min_quantity !== null && product.bulk_price_per_unit !== null && (
                  <p className="tabular mt-1 text-sm text-soil-700">
                    {t('product.bulkAvailable', {
                      quantity: formatQuantity(product.bulk_min_quantity),
                      unit,
                    })}
                    : <strong>{formatINR(product.bulk_price_per_unit)}</strong>
                  </p>
                )}
              </div>

              {/* ------------------------------------------- stock + dates */}
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-soil-500">
                    {t('farmer.stock')}
                  </dt>
                  <dd className={cn('tabular mt-0.5 font-semibold', outOfStock ? 'text-red-700' : 'text-soil-900')}>
                    {outOfStock
                      ? t('product.outOfStock')
                      : `${formatQuantity(product.stock_quantity)} ${unit}`}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-soil-500">
                    {t('farmer.minOrder')}
                  </dt>
                  <dd className="tabular mt-0.5 font-semibold text-soil-900">
                    {formatQuantity(minOrder)} {unit}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-soil-500">
                    {t('product.harvestDate')}
                  </dt>
                  <dd className="mt-0.5 font-semibold text-soil-900">
                    {formatDate(product.harvest_date)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-soil-500">
                    {t('product.grade')}
                  </dt>
                  <dd className="mt-0.5 font-semibold text-soil-900">
                    {t(gradeLabelKey(product.grade))}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-3 text-sm text-soil-600">
                {product.offers_delivery ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Truck className="size-4" aria-hidden="true" />
                    {t('product.delivery')}
                    {product.delivery_charge > 0 && (
                      <span className="tabular font-semibold">
                        ({formatINR(product.delivery_charge)})
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <Package className="size-4" aria-hidden="true" />
                    {t('product.noDelivery')}
                  </span>
                )}
                {product.offers_pickup && (
                  <span className="inline-flex items-center gap-1.5">
                    <Store className="size-4" aria-hidden="true" />
                    {t('product.pickup')}
                  </span>
                )}
              </div>

              {/* ------------------------------------------------- quantity */}
              {!outOfStock && !isOwner && (
                <div className="mt-5">
                  <label htmlFor="quantity" className="block text-sm font-semibold text-soil-800">
                    {t('customer.quantity')}
                  </label>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setQuantity(Math.max(minOrder, chosen - minOrder))}
                      disabled={chosen <= minOrder}
                      aria-label={t('common.previous')}
                    >
                      <Minus className="size-4" aria-hidden="true" />
                    </Button>
                    <input
                      id="quantity"
                      type="number"
                      inputMode="decimal"
                      value={chosen}
                      min={minOrder}
                      max={product.stock_quantity}
                      step={minOrder}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (Number.isFinite(next)) setQuantity(next);
                      }}
                      className="tabular h-11 w-24 rounded-[var(--radius-control)] border border-soil-300 px-3 text-center text-sm font-semibold focus:border-leaf-600 focus:outline-none focus:ring-2 focus:ring-leaf-600/30"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setQuantity(Math.min(product.stock_quantity, chosen + minOrder))}
                      disabled={chosen >= product.stock_quantity}
                      aria-label={t('common.next')}
                    >
                      <Plus className="size-4" aria-hidden="true" />
                    </Button>
                    <span className="text-sm text-soil-600">{unit}</span>
                  </div>

                  {chosen < minOrder && (
                    <p className="mt-1.5 text-xs font-medium text-amber-800">
                      {t('validation.quantityBelowMin', { min: `${minOrder} ${unit}` })}
                    </p>
                  )}
                  {chosen > product.stock_quantity && (
                    <p className="mt-1.5 text-xs font-medium text-red-700">
                      {t('validation.quantityAboveStock', {
                        max: `${formatQuantity(product.stock_quantity)} ${unit}`,
                      })}
                    </p>
                  )}

                  <div className="mt-3 flex items-center justify-between rounded-[var(--radius-control)] bg-soil-50 px-3 py-2">
                    <span className="text-sm text-soil-700">{t('customer.lineTotal')}</span>
                    <span className="tabular text-lg font-bold text-soil-900">
                      {formatINR(lineTotal)}
                    </span>
                  </div>
                  {bulkApplies && (
                    <p className="mt-1 text-xs font-semibold text-leaf-800">
                      Bulk price applied at {formatQuantity(product.bulk_min_quantity!)} {unit} or
                      more.
                    </p>
                  )}
                </div>
              )}

              {cartMessage && (
                <Notice
                  tone={cartMessage.tone === 'success' ? 'success' : 'danger'}
                  className="mt-4"
                >
                  {cartMessage.text}
                </Notice>
              )}

              {/* -------------------------------------------------- actions */}
              <div className="mt-5 space-y-2">
                {isOwner ? (
                  <Button block variant="outline" onClick={() => navigate('/farmer/products')}>
                    {t('nav.myProducts')}
                  </Button>
                ) : (
                  <>
                    <Button
                      block
                      size="lg"
                      onClick={() => void addToCart()}
                      loading={adding}
                      disabled={outOfStock || chosen < minOrder || chosen > product.stock_quantity}
                    >
                      <ShoppingCart className="size-5" aria-hidden="true" />
                      {t('customer.addToCart')}
                    </Button>
                    <Button
                      block
                      size="lg"
                      variant="secondary"
                      onClick={() => void buyNow()}
                      disabled={outOfStock || chosen < minOrder || chosen > product.stock_quantity}
                    >
                      {t('customer.buyNow')}
                    </Button>
                  </>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (!user) {
                        navigate('/auth/choose-role', { state: { from: `/products/${id}` } });
                        return;
                      }
                      setContactOpen(true);
                    }}
                  >
                    <MessageSquare className="size-4" aria-hidden="true" />
                    {t('customer.contactFarmer')}
                  </Button>

                  {!isOwner && (
                    <Button
                      variant="outline"
                      loading={savingToList}
                      onClick={() => void toggleSaved()}
                    >
                      <Bookmark
                        className={cn('size-4', saved && 'fill-leaf-700 text-leaf-700')}
                        aria-hidden="true"
                      />
                      {saved ? 'Saved' : t('customer.saveForLater')}
                    </Button>
                  )}
                </div>

                {!isOwner && (
                  <Button
                    block
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (!user) {
                        navigate('/auth/choose-role', { state: { from: `/products/${id}` } });
                        return;
                      }
                      setReportOpen(true);
                    }}
                  >
                    <AlertTriangle className="size-4" aria-hidden="true" />
                    {t('product.reportProduct')}
                  </Button>
                )}
              </div>
            </CardBody>
          </Card>

          {/* ------------------------------------------------ farmer card */}
          {product.farmer && (
            <Card className="mt-4">
              <CardBody>
                <h2 className="text-sm font-bold uppercase tracking-wide text-soil-600">
                  {t('product.farmer')}
                </h2>
                <div className="mt-3 flex items-center gap-3">
                  {product.farmer.profile_photo ? (
                    <img
                      src={fileUrl(product.farmer.profile_photo) ?? ''}
                      alt=""
                      className="size-12 rounded-full object-cover"
                    />
                  ) : (
                    <span className="grid size-12 place-items-center rounded-full bg-leaf-100 text-leaf-700">
                      <Store className="size-6" aria-hidden="true" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-bold text-soil-900">
                      {product.farmer.farm_name ?? product.farmer.full_name}
                    </p>
                    <p className="truncate text-xs text-soil-600">{product.farmer.full_name}</p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <VerificationBadge status={product.farmer.verification_status} />
                  {(product.farmer.rating_count > 0 || product.farmer.rating_avg !== null) && (
                    <Rating
                      value={product.farmer.rating_avg}
                      count={product.farmer.rating_count}
                    />
                  )}
                </div>

                <p className="mt-3 text-sm text-soil-600">
                  {product.farmer.village}, {product.farmer.district}, {product.farmer.state}
                </p>

                {product.farmer.bio && (
                  <p className="mt-2 text-sm leading-relaxed text-soil-700">{product.farmer.bio}</p>
                )}

                <Link
                  to={`/farmers/${product.farmer.user_id}`}
                  className="mt-3 inline-block text-sm font-semibold text-leaf-700 hover:underline"
                >
                  {t('common.viewDetails')} →
                </Link>
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      <ContactFarmerModal
        open={contactOpen}
        onClose={() => setContactOpen(false)}
        farmerId={product.farmer_id}
        productId={product.id}
        productName={product.name}
      />

      <ReportProductModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        productId={product.id}
      />
    </div>
  );
}

/* ------------------------------------------------------------ quality */

function QualitySection({ product }: { product: ProductDetail }) {
  const { t } = useTranslation();
  const reports: QualityReport[] = product.qualityReports ?? [];

  const facts = [
    { label: t('farmer.grade'), value: t(gradeLabelKey(product.grade)) },
    { label: t('farmer.variety'), value: product.variety },
    { label: t('farmer.harvestDate'), value: formatDate(product.harvest_date) },
    {
      label: t('farmer.moisture'),
      value:
        product.moisture_content === null || product.moisture_content === undefined
          ? null
          : `${product.moisture_content}%`,
    },
    { label: t('farmer.defects'), value: product.visible_defects },
    { label: t('farmer.sizeAppearance'), value: product.size_appearance },
    { label: t('farmer.storage'), value: product.storage_conditions },
    { label: t('farmer.pesticideInfo'), value: product.pesticide_info },
  ].filter((fact) => fact.value);

  return (
    <Card className="mt-6">
      <CardBody>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold text-soil-900">{t('product.qualityInfo')}</h2>
          <Badge tone="neutral" icon={<Info className="size-3.5" aria-hidden="true" />}>
            {t('quality.farmerProvided')}
          </Badge>
        </div>

        <p className="mt-1.5 text-xs leading-relaxed text-soil-600">
          {t('quality.distinctNote')}
        </p>

        {facts.length === 0 ? (
          <p className="mt-4 text-sm text-soil-600">{t('product.noQualityInfo')}</p>
        ) : (
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            {facts.map((fact) => (
              <div key={fact.label} className="rounded-[var(--radius-control)] bg-rice-100 px-3 py-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-soil-500">
                  {fact.label}
                </dt>
                <dd className="mt-0.5 text-sm text-soil-800">{String(fact.value)}</dd>
              </div>
            ))}
          </dl>
        )}

        {product.organic_certified && (
          <Notice tone="success" className="mt-4">
            <strong>{t('farmer.organicCertified')}</strong>
            {product.organic_cert_number ? ` — ${product.organic_cert_number}` : ''}
          </Notice>
        )}

        {/* ------------------------------------------- inspection reports */}
        <h3 className="mt-6 text-sm font-bold uppercase tracking-wide text-soil-600">
          {t('product.inspectionDocs')}
        </h3>

        {reports.length === 0 ? (
          <p className="mt-2 text-sm text-soil-600">{t('product.noInspection')}</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {reports.map((report) => (
              <li
                key={report.id}
                className="rounded-[var(--radius-control)] border border-soil-200 p-3.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-soil-900">
                      {report.title ?? report.report_type.replace(/_/g, ' ')}
                    </span>
                    {report.verification_status === 'verified' ? (
                      <Badge tone="success" icon={<ShieldCheck className="size-3.5" aria-hidden="true" />}>
                        {t('quality.verifiedInspection')}
                      </Badge>
                    ) : report.verification_status === 'pending' ? (
                      <Badge tone="warning">{t('quality.inspectionPending')}</Badge>
                    ) : report.verification_status === 'rejected' ? (
                      <Badge tone="danger">{t('quality.rejected')}</Badge>
                    ) : null}
                  </div>
                </div>

                {report.summary && (
                  <p className="mt-1.5 text-sm leading-relaxed text-soil-700">{report.summary}</p>
                )}

                <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-soil-600">
                  {report.inspection_provider && (
                    <div className="flex gap-1">
                      <dt>{t('market.source')}:</dt>
                      <dd className="font-medium text-soil-800">{report.inspection_provider}</dd>
                    </div>
                  )}
                  {report.inspection_date && (
                    <div className="flex gap-1">
                      <dt>{t('market.observedOn')}:</dt>
                      <dd className="font-medium text-soil-800">
                        {formatDate(report.inspection_date)}
                      </dd>
                    </div>
                  )}
                  {report.inspector_name && (
                    <div className="flex gap-1">
                      <dt>Inspector:</dt>
                      <dd className="font-medium text-soil-800">{report.inspector_name}</dd>
                    </div>
                  )}
                </dl>

                {report.ai_findings && (
                  <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3">
                    <AiAssessmentBadge />
                    <p className="mt-1.5 text-xs leading-relaxed text-sky-900">
                      {report.ai_disclaimer ?? t('quality.aiDisclaimer')}
                    </p>
                  </div>
                )}

                {report.report_document ? (
                  <a
                    href={fileUrl(report.report_document) ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-leaf-700 hover:underline"
                  >
                    <FileText className="size-4" aria-hidden="true" />
                    Open the inspection document
                  </a>
                ) : report.verification_status !== 'verified' ? (
                  <p className="mt-2 text-xs text-soil-500">
                    The attached document will be available once our team has reviewed it.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <p className="mt-5 rounded-[var(--radius-control)] bg-soil-50 p-3 text-xs leading-relaxed text-soil-700">
          {t('quality.aiLimits')}
        </p>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------ reviews */

function ReviewsSection({ reviews }: { reviews: ProductReview[] }) {
  const { t } = useTranslation();

  const average =
    reviews.length > 0
      ? Math.round(
          (reviews.reduce((sum, review) => sum + review.product_rating, 0) / reviews.length) * 10,
        ) / 10
      : null;

  return (
    <Card className="mt-6">
      <CardBody>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-soil-900">{t('product.reviews')}</h2>
          {average !== null && <Rating value={average} count={reviews.length} size="md" />}
        </div>

        {reviews.length === 0 ? (
          <p className="mt-3 text-sm text-soil-600">{t('product.noReviews')}</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {reviews.map((review) => (
              <li key={review.id} className="border-b border-soil-100 pb-4 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-soil-900">
                    {review.reviewer_display_name}
                  </span>
                  {review.is_verified_purchase && (
                    <Badge tone="leaf">{t('customer.verifiedPurchase')}</Badge>
                  )}
                  <span className="text-xs text-soil-500">{formatDate(review.created_at)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-4">
                  <span className="flex items-center gap-1.5 text-xs text-soil-600">
                    {t('customer.reviewProduct')}:
                    <Rating value={review.product_rating} />
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-soil-600">
                    {t('customer.reviewSeller')}:
                    <Rating value={review.seller_rating} />
                  </span>
                </div>
                {review.comment && (
                  <p className="mt-2 text-sm leading-relaxed text-soil-700">{review.comment}</p>
                )}
                {review.photo_path && (
                  <img
                    src={fileUrl(review.photo_path) ?? ''}
                    alt=""
                    className="mt-2 size-24 rounded-lg object-cover"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------- modals */

function ContactFarmerModal({
  open,
  onClose,
  farmerId,
  productId,
  productName,
}: {
  open: boolean;
  onClose: () => void;
  farmerId: string;
  productId: string;
  productName: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!body.trim()) return;
    setSending(true);
    setError(null);
    try {
      const result = await messagesApi.open({
        other_user_id: farmerId,
        product_id: productId,
        message: body.trim(),
      });
      onClose();
      setBody('');
      navigate(`/customer/messages?conversation=${result.conversation.id}`);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('customer.contactFarmer')}
      description={t('messages.aboutProduct', { name: productName })}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={sending}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void send()} loading={sending} disabled={!body.trim()}>
            {t('messages.send')}
          </Button>
        </>
      }
    >
      {error && <Notice tone="danger" className="mb-3">{error}</Notice>}

      <TextArea
        name="contact-message"
        label={t('messages.typeMessage')}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={4}
        autoFocus
      />

      <p className="mt-3 text-xs leading-relaxed text-soil-600">{t('messages.shareContactHelp')}</p>
    </Modal>
  );
}

function ReportProductModal({
  open,
  onClose,
  productId,
}: {
  open: boolean;
  onClose: () => void;
  productId: string;
}) {
  const { t } = useTranslation();
  const [issueType, setIssueType] = useState('quality');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await qualityApi.reportIssue({
        product_id: productId,
        issue_type: issueType,
        description: description.trim(),
      });
      setDone(true);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        onClose();
        setDone(false);
        setDescription('');
      }}
      title={t('quality.reportIssue')}
      description={t('quality.reportIssueSub')}
      footer={
        done ? (
          <Button onClick={onClose}>{t('common.close')}</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => void submit()}
              loading={submitting}
              disabled={description.trim().length < 10}
            >
              {t('common.submit')}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <Notice tone="success">{t('quality.issueSubmitted')}</Notice>
      ) : (
        <div className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}

          <div>
            <label htmlFor="issue-type" className="block text-sm font-semibold text-soil-800">
              {t('quality.issueType')}
            </label>
            <select
              id="issue-type"
              value={issueType}
              onChange={(event) => setIssueType(event.target.value)}
              className="mt-1.5 w-full rounded-[var(--radius-control)] border border-soil-300 px-3 py-2.5 text-sm focus:border-leaf-600 focus:outline-none focus:ring-2 focus:ring-leaf-600/30"
            >
              <option value="quality">Quality differs from the description</option>
              <option value="misleading">Listing is misleading</option>
              <option value="quantity">Quantity received was wrong</option>
              <option value="safety">Safety concern</option>
              <option value="other">Something else</option>
            </select>
          </div>

          <TextArea
            name="issue-description"
            label={t('quality.issueDescription')}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            hint="Please give as much detail as you can. At least a sentence."
          />
        </div>
      )}
    </Modal>
  );
}
