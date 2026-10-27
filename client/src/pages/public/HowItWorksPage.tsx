import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ClipboardCheck,
  HandCoins,
  MessageSquare,
  PackageCheck,
  Search,
  ShoppingBasket,
  Sprout,
  Star,
} from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

interface Step {
  icon: typeof Sprout;
  title: string;
  body: string;
}

/** A plain-language walkthrough for both sides of the marketplace. */
export default function HowItWorksPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('nav.howItWorks'));

  const farmerSteps: Step[] = [
    {
      icon: Sprout,
      title: 'Register your farm',
      body: 'Give your name, contact details, and where you farm. Add your farm name if you have one.',
    },
    {
      icon: ClipboardCheck,
      title: 'List a crop',
      body: 'Add photos, the quantity you have, when you harvested it, and the price you want. You choose the unit — kilogram, quintal, tonne, piece or bag.',
    },
    {
      icon: HandCoins,
      title: 'Set your price',
      body: 'Your price is yours. RythuDirect never changes it. Market information is shown for comparison only.',
    },
    {
      icon: MessageSquare,
      title: 'Answer customers',
      body: 'Buyers can message you about a crop. You decide whether to share your phone number.',
    },
    {
      icon: PackageCheck,
      title: 'Fulfil the order',
      body: 'Accept the order, prepare it, then mark it ready for pickup, shipped, or delivered as it progresses.',
    },
    {
      icon: Star,
      title: 'Build your reputation',
      body: 'Customers who bought from you can leave a review. Verified farmers also show a badge.',
    },
  ];

  const customerSteps: Step[] = [
    {
      icon: Search,
      title: 'Find crops near you',
      body: 'Search by crop, then filter by state and district, quality grade, price range, and whether the farmer delivers or offers pickup.',
    },
    {
      icon: ClipboardCheck,
      title: 'Check the details',
      body: 'Read the farmer quality notes, the harvest date, the quantity available, and any inspection documents that have been reviewed.',
    },
    {
      icon: ShoppingBasket,
      title: 'Add to your cart',
      body: 'Choose your quantity. The cart shows the unit price, any bulk price, the delivery charge, and the full total before you commit.',
    },
    {
      icon: PackageCheck,
      title: 'Place the order',
      body: 'Pick a delivery address or choose pickup. If online payment is configured you can pay now, otherwise pay the farmer on handover.',
    },
    {
      icon: MessageSquare,
      title: 'Stay in touch',
      body: 'Message the farmer about your order, and follow each status change from your orders page.',
    },
    {
      icon: Star,
      title: 'Leave a review',
      body: 'After delivery you can rate the product and the farmer, and add a photo. Only verified buyers can review.',
    },
  ];

  const faqs = [
    {
      q: 'Does RythuDirect take a commission?',
      a: 'A platform service fee, if any, is shown separately on the cart and at checkout so you always see exactly what you are paying. The farmer listed price is never altered.',
    },
    {
      q: 'What happens if a farmer does not accept my order?',
      a: 'An order stays as awaiting farmer confirmation until the farmer responds. If they cannot fulfil it they can reject it, and the stock they had reserved is released. No money moves without a confirmed order.',
    },
    {
      q: 'Can I buy from several farmers at once?',
      a: 'Yes. Your cart is split into one order per farmer automatically, because each farmer fulfils their own produce. You see the split, and each total, before you confirm.',
    },
    {
      q: 'How do I know a crop is good quality?',
      a: 'Look at three separate things: the grade the farmer set, the quality details they wrote, and whether an inspection document has been verified by our team. These are not the same thing, and each is labelled on the product page.',
    },
    {
      q: 'Do I need to install an app?',
      a: 'No. RythuDirect works in any modern mobile browser and on a computer. The interface is available in English, Telugu and Hindi.',
    },
  ];

  return (
    <div className="container-page py-10">
      <header className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-bold text-soil-900 sm:text-4xl">
          {t('landing.howItWorks')}
        </h1>
        <p className="mt-3 text-base leading-relaxed text-soil-600">
          {t('landing.howItWorksSub')}
        </p>
      </header>

      <StepSection
        id="for-farmers"
        heading={t('landing.forFarmers')}
        steps={farmerSteps}
        tone="leaf"
        action={
          <Link to="/farmer/register">
            <Button>{t('landing.chooseFarmer')}</Button>
          </Link>
        }
      />

      <StepSection
        id="for-customers"
        heading={t('landing.forCustomers')}
        steps={customerSteps}
        tone="soil"
        action={
          <Link to="/explore">
            <Button variant="secondary">{t('landing.browseCrops')}</Button>
          </Link>
        }
      />

      <section className="mt-14" aria-labelledby="questions">
        <h2 id="questions" className="text-2xl font-bold text-soil-900">
          {t('landing.faq')}
        </h2>
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {faqs.map((faq) => (
            <details
              key={faq.q}
              className="group rounded-[var(--radius-card)] border border-soil-200 bg-white p-4"
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
    </div>
  );
}

function StepSection({
  id,
  heading,
  steps,
  tone,
  action,
}: {
  id: string;
  heading: string;
  steps: Step[];
  tone: 'leaf' | 'soil';
  action: React.ReactNode;
}) {
  const badge = tone === 'leaf' ? 'bg-leaf-50 text-leaf-700' : 'bg-soil-100 text-soil-700';

  return (
    <section className="mt-14" aria-labelledby={id}>
      <h2 id={id} className="text-2xl font-bold text-soil-900">
        {heading}
      </h2>
      <ol className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title}>
            <Card className="h-full">
              <CardBody>
                <div className="flex items-center gap-3">
                  <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${badge}`}>
                    <step.icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="tabular text-sm font-bold text-soil-400">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                </div>
                <h3 className="mt-3 font-bold text-soil-900">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-soil-600">{step.body}</p>
              </CardBody>
            </Card>
          </li>
        ))}
      </ol>
      <div className="mt-5">{action}</div>
    </section>
  );
}
