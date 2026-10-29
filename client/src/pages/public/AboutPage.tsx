import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HandCoins, Leaf, ShieldCheck, Users } from 'lucide-react';
import { Card, CardBody, Notice } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export default function AboutPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('nav.about'));

  const values = [
    {
      icon: HandCoins,
      title: 'The farmer sets the price',
      body: 'No algorithm, no suggested price, no automatic adjustment. A farmer decides what their crop is worth and can change it whenever they want.',
    },
    {
      icon: ShieldCheck,
      title: 'Claims must be earned',
      body: 'A verified badge means we checked something. An inspection document is only shown once a reviewer has approved it. We would rather show nothing than imply something untrue.',
    },
    {
      icon: Leaf,
      title: 'Plain language, in your language',
      body: 'The interface is available in English, Telugu and Hindi, written for people who are not technology experts.',
    },
    {
      icon: Users,
      title: 'Direct means fewer hands',
      body: 'Fewer intermediaries between the field and the kitchen means a better price for the grower and fresher produce for the buyer.',
    },
  ];

  return (
    <div className="container-page py-10">
      <header className="mx-auto max-w-3xl text-center">
        <h1 className="text-3xl font-bold text-soil-900 sm:text-4xl">{t('nav.about')}</h1>
        <p className="mt-4 text-base leading-relaxed text-soil-600">
          RythuDirect is a marketplace that connects farmers across India directly with the people
          who buy their produce. A farmer lists what they have grown, sets their own price, and
          deals with the buyer without a chain of middlemen taking a share.
        </p>
      </header>

      <section className="mt-12 grid gap-4 sm:grid-cols-2">
        {values.map((value) => (
          <Card key={value.title}>
            <CardBody>
              <span className="grid size-11 place-items-center rounded-xl bg-leaf-50 text-leaf-700">
                <value.icon className="size-5" aria-hidden="true" />
              </span>
              <h2 className="mt-3 font-bold text-soil-900">{value.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-soil-600">{value.body}</p>
            </CardBody>
          </Card>
        ))}
      </section>

      <section className="mt-12 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardBody>
            <h2 className="text-lg font-bold text-soil-900">How this platform is built</h2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-soil-600">
              <li>
                Every listing, order and message is stored in a relational database. Nothing
                important lives only in the browser.
              </li>
              <li>
                Access is enforced in the database itself, not just by hiding buttons. A farmer
                cannot read another farmer&rsquo;s orders, and a customer cannot see anyone
                else&rsquo;s cart.
              </li>
              <li>
                Payment details are never stored by us. Where an online gateway is configured, the
                payment is confirmed by the provider and verified on our server.
              </li>
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h2 className="text-lg font-bold text-soil-900">What this platform is not</h2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-soil-600">
              <li>
                We do not certify that any crop is free from pesticide residue, contamination or
                disease. That requires laboratory testing, and we say so on every product page.
              </li>
              <li>
                We do not set or recommend prices. Market information, where it exists, is shown
                for comparison only.
              </li>
              <li>
                We do not guarantee that a farmer will accept an order. They confirm each order
                themselves.
              </li>
            </ul>
          </CardBody>
        </Card>
      </section>

      <Notice tone="info" className="mt-8">
        This is a working marketplace application. Some optional integrations — online payments,
        maps, AI-assisted image assessment, and official market price data — are only active when
        credentials for them have been configured. Where they are not, the interface says so
        plainly rather than pretending the feature is available.
      </Notice>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link to="/farmer/register">
          <Button>{t('landing.sellYourCrops')}</Button>
        </Link>
        <Link to="/explore">
          <Button variant="outline">{t('landing.browseCrops')}</Button>
        </Link>
      </div>
    </div>
  );
}
