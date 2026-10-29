import { useTranslation } from 'react-i18next';
import { Mail, MapPin, MessageSquare, Phone } from 'lucide-react';
import { Card, CardBody, Notice } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

/**
 * Contact information.
 *
 * The address and phone number here come from the same translation keys the
 * footer uses, and are placeholder values. They must be replaced with real
 * details before this is used by the public — inventing a working support line
 * would be worse than showing none.
 */
export default function ContactPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('footer.contactUs'));

  return (
    <div className="container-page py-10">
      <header className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-bold text-soil-900 sm:text-4xl">{t('footer.contactUs')}</h1>
        <p className="mt-3 text-base leading-relaxed text-soil-600">
          If something is wrong with an order, a listing, or your account, tell us and we will look
          into it.
        </p>
      </header>

      <div className="mx-auto mt-10 grid max-w-4xl gap-4 sm:grid-cols-2">
        <Card>
          <CardBody>
            <span className="grid size-11 place-items-center rounded-xl bg-leaf-50 text-leaf-700">
              <Mail className="size-5" aria-hidden="true" />
            </span>
            <h2 className="mt-3 font-bold text-soil-900">Email</h2>
            <p className="mt-1 text-sm text-soil-600">
              The fastest way to reach us, and the best for anything you need in writing.
            </p>
            <a
              href={`mailto:${t('footer.email')}`}
              className="mt-2 inline-block font-semibold text-leaf-700 hover:underline"
            >
              {t('footer.email')}
            </a>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <span className="grid size-11 place-items-center rounded-xl bg-leaf-50 text-leaf-700">
              <Phone className="size-5" aria-hidden="true" />
            </span>
            <h2 className="mt-3 font-bold text-soil-900">Phone</h2>
            <p className="mt-1 text-sm text-soil-600">
              For urgent problems with an order that is already in progress.
            </p>
            <p className="mt-2 font-semibold text-soil-900">{t('footer.phone')}</p>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <span className="grid size-11 place-items-center rounded-xl bg-leaf-50 text-leaf-700">
              <MapPin className="size-5" aria-hidden="true" />
            </span>
            <h2 className="mt-3 font-bold text-soil-900">Address</h2>
            <p className="mt-2 text-sm text-soil-700">{t('footer.address')}</p>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <span className="grid size-11 place-items-center rounded-xl bg-leaf-50 text-leaf-700">
              <MessageSquare className="size-5" aria-hidden="true" />
            </span>
            <h2 className="mt-3 font-bold text-soil-900">A problem with a specific order?</h2>
            <p className="mt-1 text-sm text-soil-600">
              Message the farmer directly from your orders page, and report the issue so our team
              can review it too.
            </p>
            <a href="/customer/orders" className="mt-3 inline-block">
              <Button size="sm" variant="outline">
                {t('customer.orders')}
              </Button>
            </a>
          </CardBody>
        </Card>
      </div>

      <Notice tone="warning" className="mx-auto mt-8 max-w-4xl" title="Before you rely on these details">
        The email address, phone number and postal address shown above are placeholders from the
        application template. Replace them in the translation files with your real support contact
        details before making this site public.
      </Notice>
    </div>
  );
}
