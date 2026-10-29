import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CreditCard, MapPin, Package, ShieldCheck, Sprout, Star } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

/** Help centre: short answers, grouped by what the reader is trying to do. */
export default function HelpPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('footer.helpCentre'));

  const sections = [
    {
      icon: Sprout,
      title: 'Selling on RythuDirect',
      items: [
        {
          q: 'How do I list a crop?',
          a: 'Register as a farmer, sign in, then choose "Add New Crop" in your dashboard. Fill in the name, category, quantity available, unit, and your price. Add at least one clear photo. You can save it as a draft and come back to it before publishing.',
        },
        {
          q: 'Can I change my price later?',
          a: 'Yes. Open the listing from "My Products" and edit it. Your new price applies to future orders; orders already placed keep the price that was agreed at the time.',
        },
        {
          q: 'What unit should I use?',
          a: 'Whatever is normal for your crop — kilogram, quintal, tonne, piece, or bag. You can also set your own unit if none of those fit.',
        },
        {
          q: 'How do I stop selling a crop?',
          a: 'You can mark a listing out of stock, which keeps the details but stops new orders, or deactivate it entirely. Deleting a listing is permanent and cannot be undone.',
        },
      ],
    },
    {
      icon: Package,
      title: 'Buying and orders',
      items: [
        {
          q: 'Why was my order split into two?',
          a: 'If your cart has produce from more than one farmer, it is split into one order per farmer. Each farmer fulfils and confirms their own produce, so they are tracked separately. You see the split before you confirm.',
        },
        {
          q: 'The quantity I want is not available.',
          a: 'You cannot order more than the farmer currently has in stock. The product page shows the quantity available, and both the cart and the server refuse an order above it. Try a smaller quantity, or message the farmer to ask when more will be ready.',
        },
        {
          q: 'How do I cancel an order?',
          a: 'You can cancel from the order page while it is still awaiting confirmation. Once a farmer has accepted and started preparing, contact them directly — they can cancel it from their side.',
        },
      ],
    },
    {
      icon: CreditCard,
      title: 'Payments',
      items: [
        {
          q: 'Why can I not pay online?',
          a: 'Online payment is only offered when a payment gateway has been configured for this installation. If it has not, you can still place the order and pay the farmer directly on delivery or pickup. The checkout page tells you which situation applies.',
        },
        {
          q: 'Do you store my card details?',
          a: 'No. Card numbers, CVV codes and UPI PINs are never sent to or stored by RythuDirect. Where a gateway is configured, the payment is handled entirely by the provider and we only receive a reference and a status.',
        },
      ],
    },
    {
      icon: ShieldCheck,
      title: 'Quality and trust',
      items: [
        {
          q: 'What does the verified badge mean?',
          a: 'It means we reviewed that farmer\u2019s details and documents. It is about the person, not a guarantee about any particular crop.',
        },
        {
          q: 'Is a grade A crop laboratory tested?',
          a: 'Not necessarily. A grade is the farmer\u2019s own description of size, appearance and condition. Laboratory or inspection results are only shown when an actual document has been reviewed and approved by our team.',
        },
        {
          q: 'How do I report a problem?',
          a: 'Use the report option on the product page, or report the order from your orders page. Describe what was wrong and, if you can, attach a photo. Our team reviews every report.',
        },
      ],
    },
    {
      icon: MapPin,
      title: 'Locations and delivery',
      items: [
        {
          q: 'How do I find farmers near me?',
          a: 'Use the Nearby Farmers page and choose your state and district, or search by crop. Each farmer decides whether to publish an approximate map location; if they have not, you will still see their village and district.',
        },
        {
          q: 'Who sets the delivery charge?',
          a: 'The farmer does, per listing. Some farmers offer pickup only. The exact delivery amount appears on your cart and again at checkout before you confirm anything.',
        },
      ],
    },
    {
      icon: Star,
      title: 'Reviews',
      items: [
        {
          q: 'Who can leave a review?',
          a: 'Only a customer who actually bought and received that product from that farmer. This is why reviews are marked as verified purchases — it means we know the order happened.',
        },
        {
          q: 'Can I review the same order twice?',
          a: 'No. One review per order, so a rating cannot be inflated by repeat submissions.',
        },
      ],
    },
  ];

  return (
    <div className="container-page py-10">
      <header className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-bold text-soil-900 sm:text-4xl">{t('footer.helpCentre')}</h1>
        <p className="mt-3 text-base leading-relaxed text-soil-600">
          Short answers to the questions we get most often. If yours is not here, write to us.
        </p>
      </header>

      <div className="mt-10 space-y-8">
        {sections.map((section) => (
          <section key={section.title} aria-labelledby={`help-${section.title}`}>
            <h2
              id={`help-${section.title}`}
              className="flex items-center gap-2 text-xl font-bold text-soil-900"
            >
              <section.icon className="size-5 text-leaf-700" aria-hidden="true" />
              {section.title}
            </h2>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {section.items.map((item) => (
                <details
                  key={item.q}
                  className="group rounded-[var(--radius-card)] border border-soil-200 bg-white p-4"
                >
                  <summary className="cursor-pointer list-none font-semibold text-soil-900 marker:hidden">
                    <span className="flex items-start justify-between gap-3">
                      {item.q}
                      <span
                        className="mt-0.5 shrink-0 text-soil-400 transition-transform group-open:rotate-45"
                        aria-hidden="true"
                      >
                        +
                      </span>
                    </span>
                  </summary>
                  <p className="mt-2 text-sm leading-relaxed text-soil-600">{item.a}</p>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>

      <Card className="mt-10">
        <CardBody className="text-center">
          <h2 className="font-bold text-soil-900">Still stuck?</h2>
          <p className="mt-1 text-sm text-soil-600">
            Write to us and describe what you were trying to do.
          </p>
          <Link
            to="/contact"
            className="mt-3 inline-block font-semibold text-leaf-700 hover:underline"
          >
            {t('footer.contactUs')} →
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}
