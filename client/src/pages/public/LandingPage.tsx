import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  HandCoins,
  Leaf,
  MapPin,
  Microscope,
  PackageCheck,
  Search,
  ShieldCheck,
  ShoppingBasket,
  Sprout,
  Tractor,
  TrendingUp,
} from 'lucide-react';
import { useAsync } from '@/hooks/useCart';
import { products as productsApi, farmers as farmersApi, market as marketApi } from '@/lib/services';
import { formatQuantity } from '@/lib/format';
import type { FarmerSummary } from '@/lib/types';
import { ProductCard } from '@/components/marketplace/ProductCard';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, ErrorState, EmptyState, ProductGridSkeleton, Skeleton } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { HeroSearch } from '@/components/marketplace/HeroSearch';

/**
 * The landing page.
 *
 * Every list here is real data from the database. Where a list is empty the
 * section either hides itself or shows an honest empty state — there is no
 * invented inventory on this page.
 */
export default function LandingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  useDocumentTitle('');

  const fresh = useAsync(
    (signal) => productsApi.list({ sort: 'recent', page_size: 8 }, signal),
    [],
  );
  const bestValue = useAsync(
    (signal) => productsApi.list({ sort: 'price_asc', page_size: 4 }, signal),
    [],
  );
  const nearbyFarmers = useAsync((signal) => farmersApi.list({ page_size: 4 }, signal), []);
  const categories = useAsync((signal) => productsApi.categories(signal), []);

  const totalListings = fresh.data?.total ?? 0;

  return (
    <>
      <Hero />

      {/* ---------------------------------------------------------- categories */}
      <section className="container-page py-12" aria-labelledby="popular-crops">
        <SectionHeading
          id="popular-crops"
          title={t('landing.popularCrops')}
          subtitle={t('landing.popularCropsSub')}
          action={
            <Button variant="outline" size="sm" onClick={() => navigate('/explore')}>
              {t('common.viewAll')}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          }
        />

        {categories.loading ? (
          <div className="flex flex-wrap gap-3">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-24 w-32" />
            ))}
          </div>
        ) : categories.error ? (
          <ErrorState message={categories.error} onRetry={categories.reload} />
        ) : categories.data && categories.data.categories.length > 0 ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {categories.data.categories.slice(0, 12).map((category) => (
              <li key={category.id}>
                <Link
                  to={`/explore?category=${category.id}`}
                  className="flex h-full flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-soil-200 bg-white p-4 text-center shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:border-leaf-300 hover:shadow-[var(--shadow-lifted)]"
                >
                  <span className="grid size-11 place-items-center rounded-full bg-leaf-50 text-leaf-700">
                    <Sprout className="size-5" aria-hidden="true" />
                  </span>
                  <span className="text-sm font-semibold text-soil-900">{category.name}</span>
                  {typeof category.product_count === 'number' && (
                    <span className="text-xs text-soil-500">
                      {category.product_count} {t('common.results')}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title={t('common.noData')}
            description={t('landing.popularCropsSub')}
            action={
              <Button onClick={() => navigate('/farmer/register')}>
                {t('landing.sellYourCrops')}
              </Button>
            }
          />
        )}
      </section>

      {/* ------------------------------------------------------ fresh listings */}
      <section className="bg-white py-12" aria-labelledby="fresh-listings">
        <div className="container-page">
          <SectionHeading
            id="fresh-listings"
            title={t('landing.freshListings')}
            subtitle={t('landing.freshListingsSub')}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/explore?sort=recent')}
              >
                {t('common.viewAll')}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
            }
          />

          {fresh.loading ? (
            <ProductGridSkeleton count={8} />
          ) : fresh.error ? (
            <ErrorState message={fresh.error} onRetry={fresh.reload} />
          ) : fresh.data && fresh.data.items.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {fresh.data.items.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          ) : (
            <EmptyState
              title={t('common.noData')}
              description="No crops have been listed yet. If you are a farmer, you can be the first."
              action={
                <Button onClick={() => navigate('/farmer/register')}>
                  {t('landing.sellYourCrops')}
                </Button>
              }
            />
          )}
        </div>
      </section>

      {/* ------------------------------------------------------ farmers nearby */}
      <section className="container-page py-12" aria-labelledby="farmers-near">
        <SectionHeading
          id="farmers-near"
          title={t('landing.farmersNearYou')}
          subtitle={t('landing.farmersNearYouSub')}
          action={
            <Button variant="outline" size="sm" onClick={() => navigate('/farmers')}>
              {t('common.viewAll')}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          }
        />

        {nearbyFarmers.loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-40" />
            ))}
          </div>
        ) : nearbyFarmers.error ? (
          <ErrorState message={nearbyFarmers.error} onRetry={nearbyFarmers.reload} />
        ) : nearbyFarmers.data && nearbyFarmers.data.items.length > 0 ? (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {nearbyFarmers.data.items.map((farmer) => (
              <FarmerCard key={farmer.user_id} farmer={farmer} />
            ))}
          </ul>
        ) : (
          <EmptyState title={t('common.noData')} description={t('landing.farmersNearYouSub')} />
        )}
      </section>

      {/* -------------------------------------------------------- best value */}
      {bestValue.data && bestValue.data.items.length > 0 && (
        <section className="bg-white py-12" aria-labelledby="best-value">
          <div className="container-page">
            <SectionHeading
              id="best-value"
              title={t('landing.bestValue')}
              subtitle={t('landing.bestValueSub')}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {bestValue.data.items.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </div>
        </section>
      )}

      <HowItWorks />
      <QualitySection />
      <BenefitsSection />

      {/* ----------------------------------------------------------- numbers */}
      <section className="border-y border-soil-200 bg-soil-900 py-10">
        <div className="container-page">
          <dl className="grid grid-cols-2 gap-6 text-center sm:grid-cols-4">
            <Stat
              label={t('landing.statsProducts')}
              value={totalListings > 0 ? formatQuantity(totalListings) : '—'}
            />
            <Stat
              label={t('landing.statsFarmers')}
              value={
                nearbyFarmers.data ? formatQuantity(nearbyFarmers.data.total) : '—'
              }
            />
            <Stat label={t('landing.statsStates')} value="—" hint="Shown once listings exist" />
            <Stat label={t('landing.statsOrders')} value="—" hint="Shown once orders exist" />
          </dl>
        </div>
      </section>

      <FaqSection />
    </>
  );
}

/* ------------------------------------------------------------------ pieces */

function SectionHeading({
  id,
  title,
  subtitle,
  action,
}: {
  id: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 id={id} className="text-2xl font-bold text-soil-900 sm:text-3xl">
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-sm text-soil-600">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dd className="tabular text-3xl font-bold text-white">{value}</dd>
      <dt className="mt-1 text-xs font-semibold uppercase tracking-wide text-soil-300">
        {label}
      </dt>
      {hint && <p className="mt-0.5 text-[0.7rem] text-soil-400">{hint}</p>}
    </div>
  );
}

function FarmerCard({ farmer }: { farmer: FarmerSummary }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <li className="flex flex-col rounded-[var(--radius-card)] border border-soil-200 bg-white p-4 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-lifted)]">
      <div className="flex items-center gap-3">
        {farmer.profile_photo ? (
          <img
            src={`/api/files/${farmer.profile_photo}`}
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

      {farmer.verification_status === 'verified' && (
        <div className="mt-2">
          <Badge tone="success" icon={<ShieldCheck className="size-3.5" aria-hidden="true" />}>
            {t('product.verified')}
          </Badge>
        </div>
      )}

      <p className="mt-2 flex items-center gap-1 text-xs text-soil-600">
        <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">
          {farmer.village}, {farmer.district}
        </span>
      </p>

      <p className="mt-1 text-xs text-soil-500">
        {farmer.active_listings} {t('nav.myProducts').toLowerCase()}
      </p>

      <Button
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={() => navigate(`/farmers/${farmer.user_id}`)}
      >
        {t('common.viewDetails')}
      </Button>
    </li>
  );
}

function Hero() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <section className="relative overflow-hidden border-b border-soil-200 bg-gradient-to-br from-leaf-50 via-rice-100 to-soil-50">
      {/* Decorative field rows, drawn in CSS so there is no image to load. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-32 opacity-[0.07]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(115deg, var(--color-leaf-800) 0 2px, transparent 2px 22px)',
        }}
        aria-hidden="true"
      />

      <div className="container-page relative py-14 lg:py-20">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div className="animate-rise">
            <Badge tone="leaf" icon={<Leaf className="size-3.5" aria-hidden="true" />}>
              Farmer to customer, no middlemen
            </Badge>

            <h1 className="mt-4 text-4xl font-bold leading-[1.15] text-soil-900 sm:text-5xl lg:text-[3.25rem]">
              {t('landing.heroTitle')}
            </h1>

            <p className="mt-4 max-w-xl text-base leading-relaxed text-soil-700 sm:text-lg">
              {t('landing.heroSubtitle')}
            </p>

            <HeroSearch />

            <div className="mt-6 flex flex-wrap gap-3">
              <Button size="lg" onClick={() => navigate('/explore')}>
                <ShoppingBasket className="size-5" aria-hidden="true" />
                {t('landing.browseCrops')}
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => navigate('/farmer/register')}
              >
                <Sprout className="size-5" aria-hidden="true" />
                {t('landing.sellYourCrops')}
              </Button>
            </div>

            <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm text-soil-700">
              {[
                'Farmers set their own prices',
                'Compare prices before you buy',
                'Pickup or delivery',
              ].map((point) => (
                <li key={point} className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-4 shrink-0 text-leaf-700" aria-hidden="true" />
                  {point}
                </li>
              ))}
            </ul>
          </div>

          {/* Illustration panel: built from real marketplace concepts, not a
              stock photo, so it stays truthful about what the app does. */}
          <div className="animate-rise lg:justify-self-end" style={{ animationDelay: '120ms' }}>
            <div className="relative mx-auto max-w-md">
              <div className="rounded-[var(--radius-card)] border border-soil-200 bg-white p-5 shadow-[var(--shadow-lifted)]">
                <div className="flex items-center gap-2 border-b border-soil-100 pb-3">
                  <span className="size-2.5 rounded-full bg-red-400" aria-hidden="true" />
                  <span className="size-2.5 rounded-full bg-sun-400" aria-hidden="true" />
                  <span className="size-2.5 rounded-full bg-leaf-400" aria-hidden="true" />
                  <span className="ml-2 text-xs font-semibold text-soil-500">
                    Today on RythuDirect
                  </span>
                </div>

                <ul className="mt-4 space-y-3">
                  {[
                    { icon: Sprout, label: 'A farmer lists a crop', tone: 'leaf' },
                    { icon: Search, label: 'A customer finds it nearby', tone: 'info' },
                    { icon: HandCoins, label: 'Price agreed, no middleman', tone: 'leaf' },
                    { icon: PackageCheck, label: 'Delivered or picked up', tone: 'info' },
                  ].map((row) => (
                    <li key={row.label} className="flex items-center gap-3">
                      <span
                        className={
                          row.tone === 'leaf'
                            ? 'grid size-9 shrink-0 place-items-center rounded-lg bg-leaf-50 text-leaf-700'
                            : 'grid size-9 shrink-0 place-items-center rounded-lg bg-sky-50 text-sky-700'
                        }
                      >
                        <row.icon className="size-4.5" aria-hidden="true" />
                      </span>
                      <span className="text-sm font-medium text-soil-800">{row.label}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="absolute -bottom-4 -left-4 hidden rounded-xl border border-leaf-200 bg-white px-4 py-3 shadow-[var(--shadow-card)] sm:block">
                <p className="flex items-center gap-1.5 text-xs font-bold text-leaf-800">
                  <TrendingUp className="size-4" aria-hidden="true" />
                  Farmers keep more per sale
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const { t } = useTranslation();
  const steps = [
    {
      icon: ClipboardCheck,
      title: '1. A farmer lists a crop',
      body: 'They add photos, the quantity available, the harvest date, and the price they want.',
    },
    {
      icon: Search,
      title: '2. You search and compare',
      body: 'Filter by crop, quality grade, distance and price. Every price is the farmer’s own.',
    },
    {
      icon: ShoppingBasket,
      title: '3. You place an order',
      body: 'See the full total — unit price, quantity, delivery — before you confirm anything.',
    },
    {
      icon: PackageCheck,
      title: '4. Delivery or pickup',
      body: 'The farmer accepts, prepares, and hands over. You can follow each step.',
    },
  ];

  return (
    <section className="container-page py-12" aria-labelledby="how-it-works">
      <SectionHeading
        id="how-it-works"
        title={t('landing.howItWorks')}
        subtitle={t('landing.howItWorksSub')}
      />
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className="rounded-[var(--radius-card)] border border-soil-200 bg-white p-5 shadow-[var(--shadow-card)]"
          >
            <span className="grid size-11 place-items-center rounded-xl bg-leaf-50 text-leaf-700">
              <step.icon className="size-5" aria-hidden="true" />
            </span>
            <h3 className="mt-3 font-bold text-soil-900">{step.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-soil-600">{step.body}</p>
            {index < steps.length - 1 && (
              <ArrowRight
                className="mt-3 size-4 text-soil-300"
                aria-hidden="true"
              />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function QualitySection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const marketStatus = useAsync((signal) => marketApi.integrationStatus(signal), []);

  const claims = [
    {
      icon: FileCheck2,
      title: t('quality.farmerProvided'),
      body: 'Details the farmer entered themselves: grade, harvest date, storage, visible defects.',
    },
    {
      icon: Microscope,
      title: t('quality.verifiedInspection'),
      body: 'Only shown when an inspection document has been reviewed and approved by our team.',
    },
    {
      icon: ShieldCheck,
      title: t('quality.farmerVerified'),
      body: 'Separate from quality. It means we checked the farm and the farmer’s identity.',
    },
  ];

  return (
    <section className="bg-white py-12" aria-labelledby="quality">
      <div className="container-page">
        <SectionHeading
          id="quality"
          title={t('landing.qualityAndTrust')}
          subtitle={t('landing.qualityAndTrustSub')}
        />

        <div className="grid gap-4 lg:grid-cols-3">
          {claims.map((claim) => (
            <Card key={claim.title}>
              <CardBody>
                <span className="grid size-11 place-items-center rounded-xl bg-soil-100 text-soil-700">
                  <claim.icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="mt-3 font-bold text-soil-900">{claim.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-soil-600">{claim.body}</p>
              </CardBody>
            </Card>
          ))}
        </div>

        <div className="mt-4 rounded-[var(--radius-card)] border border-sky-200 bg-sky-50 p-5">
          <h3 className="text-sm font-bold text-sky-900">
            What we do not claim
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-sky-900">
            {t('quality.aiLimits')}
          </p>
          <p className="mt-2 text-xs font-semibold text-sky-900">{t('quality.aiDisclaimer')}</p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            onClick={() => navigate('/quality-standards')}
          >
            {t('nav.qualityStandards')}
          </Button>
          {marketStatus.data && (
            <p className="text-xs text-soil-600">
              <span className="font-semibold">{t('market.disclosure')}:</span>{' '}
              {marketStatus.data.message}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function BenefitsSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const farmerBenefits = [
    'Set your own price and change it whenever you want',
    'Sell in the unit that suits you — kg, quintal, tonne, bag',
    'See orders and messages in one place',
    'Decide whether you deliver or customers collect',
  ];

  const customerBenefits = [
    'See exactly who grew your food and where',
    'Compare prices across farmers near you',
    'Read quality details before you buy',
    'Know the full cost before you confirm',
  ];

  return (
    <section className="container-page py-12" aria-labelledby="benefits">
      <h2 id="benefits" className="sr-only">
        {t('landing.forFarmers')} / {t('landing.forCustomers')}
      </h2>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="bg-leaf-700 px-5 py-4">
            <h3 className="flex items-center gap-2 text-lg font-bold text-white">
              <Sprout className="size-5" aria-hidden="true" />
              {t('landing.forFarmers')}
            </h3>
            <p className="mt-0.5 text-sm text-leaf-100">{t('landing.forFarmersSub')}</p>
          </div>
          <CardBody>
            <ul className="space-y-2.5">
              {farmerBenefits.map((benefit) => (
                <li key={benefit} className="flex items-start gap-2 text-sm text-soil-700">
                  <CheckCircle2
                    className="mt-0.5 size-4 shrink-0 text-leaf-700"
                    aria-hidden="true"
                  />
                  {benefit}
                </li>
              ))}
            </ul>
            <Button
              className="mt-5"
              block
              onClick={() => navigate('/farmer/register')}
            >
              {t('landing.chooseFarmer')}
            </Button>
          </CardBody>
        </Card>

        <Card className="overflow-hidden">
          <div className="bg-soil-700 px-5 py-4">
            <h3 className="flex items-center gap-2 text-lg font-bold text-white">
              <ShoppingBasket className="size-5" aria-hidden="true" />
              {t('landing.forCustomers')}
            </h3>
            <p className="mt-0.5 text-sm text-soil-200">{t('landing.forCustomersSub')}</p>
          </div>
          <CardBody>
            <ul className="space-y-2.5">
              {customerBenefits.map((benefit) => (
                <li key={benefit} className="flex items-start gap-2 text-sm text-soil-700">
                  <CheckCircle2
                    className="mt-0.5 size-4 shrink-0 text-leaf-700"
                    aria-hidden="true"
                  />
                  {benefit}
                </li>
              ))}
            </ul>
            <Button
              className="mt-5"
              block
              variant="secondary"
              onClick={() => navigate('/customer/register')}
            >
              {t('landing.chooseCustomer')}
            </Button>
          </CardBody>
        </Card>
      </div>
    </section>
  );
}

function FaqSection() {
  const { t } = useTranslation();

  const faqs = [
    {
      q: 'Who sets the price of a crop?',
      a: 'The farmer does, always. RythuDirect never changes a farmer’s listed price. Market price information is shown for comparison only.',
    },
    {
      q: 'What does "verified farmer" mean?',
      a: 'It means our team checked the farmer’s details and documents. It is separate from product quality — a verified farmer’s crop may still be ungraded.',
    },
    {
      q: 'Is a "Grade A" crop laboratory tested?',
      a: 'Not necessarily. A grade is the farmer’s own description of size, appearance and condition. Laboratory testing is only shown when an actual inspection document has been reviewed.',
    },
    {
      q: 'Can I pay online?',
      a: 'Online payment depends on whether a payment gateway has been configured for this installation. If it has not, you can still order and pay the farmer directly on delivery or pickup.',
    },
    {
      q: 'How is delivery charged?',
      a: 'Each farmer sets their own delivery charge, or offers pickup only. You see the exact delivery amount on the cart and at checkout before confirming.',
    },
    {
      q: 'What if a crop arrives in poor condition?',
      a: 'Report it from the product page or your order. Reports go to our review team, and you can also message the farmer directly.',
    },
  ];

  return (
    <section className="container-page py-12" aria-labelledby="faq">
      <SectionHeading id="faq" title={t('landing.faq')} subtitle={t('landing.faqSub')} />
      <div className="grid gap-3 lg:grid-cols-2">
        {faqs.map((faq) => (
          <details
            key={faq.q}
            className="group rounded-[var(--radius-card)] border border-soil-200 bg-white p-4 open:shadow-[var(--shadow-card)]"
          >
            <summary className="cursor-pointer list-none font-semibold text-soil-900 marker:hidden">
              <span className="flex items-start justify-between gap-3">
                {faq.q}
                <span
                  className="mt-0.5 shrink-0 text-soil-400 transition-transform group-open:rotate-45"
                  aria-hidden="true"
                >
                  +
                </span>
              </span>
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-soil-600">{faq.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

