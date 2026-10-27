import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  FlaskConical,
  Info,
  Microscope,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { useAsync } from '@/hooks/useCart';
import { quality as qualityApi, market as marketApi } from '@/lib/services';
import { Card, CardBody, Notice, Spinner } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

/**
 * Quality standards.
 *
 * This page exists to be precise about what each claim means. The distinctions
 * it draws — registered vs identity-verified vs farmer-verified vs
 * quality-inspected — are the same ones the database and the UI enforce, so a
 * reader can trust that the labels on a product page mean what is written here.
 */
export default function QualityStandardsPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('quality.title'));

  const standards = useAsync((signal) => qualityApi.standards(signal), []);
  const aiStatus = useAsync((signal) => qualityApi.aiStatus(signal), []);
  const marketStatus = useAsync((signal) => marketApi.integrationStatus(signal), []);

  const statuses = [
    {
      icon: Info,
      tone: 'neutral' as const,
      label: t('quality.farmerProvided'),
      body: 'The farmer entered these details themselves: grade, harvest date, moisture reading, visible defects, storage, and any pesticide information. We do not verify these values.',
    },
    {
      icon: Sparkles,
      tone: 'info' as const,
      label: t('quality.aiAssessed'),
      body: 'A preliminary visual check of a photograph by an AI vision service, where one is configured. It can suggest possible discoloration, damage, or spoilage. It is a hint, not a test.',
    },
    {
      icon: Microscope,
      tone: 'warning' as const,
      label: t('quality.inspectionPending'),
      body: 'An inspection document has been attached by the farmer and is waiting for our review team. It is not yet released to customers.',
    },
    {
      icon: FileCheck2,
      tone: 'success' as const,
      label: t('quality.verifiedInspection'),
      body: 'A reviewer examined the attached document and approved it. Only then does the document become downloadable from the product page.',
    },
    {
      icon: XCircle,
      tone: 'danger' as const,
      label: t('quality.rejected'),
      body: 'The document was rejected, or its validity has expired. It is not shown as evidence of anything.',
    },
  ];

  const trustLevels = [
    {
      icon: CheckCircle2,
      label: t('quality.registeredUser'),
      body: 'Someone created an account and confirmed their email address.',
    },
    {
      icon: ShieldCheck,
      label: t('quality.identityVerified'),
      body: 'We have checked an identity document for this person. Shown to administrators only.',
    },
    {
      icon: ShieldCheck,
      label: t('quality.farmerVerified'),
      body: 'We reviewed the farm details and supporting documents. This farmer shows a verified badge to customers.',
    },
    {
      icon: FlaskConical,
      label: t('quality.qualityInspected'),
      body: 'A specific batch of a specific crop has a reviewed inspection document. This is about the produce, not the person.',
    },
  ];

  return (
    <div className="container-page py-10">
      <header className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-bold text-soil-900 sm:text-4xl">{t('quality.title')}</h1>
        <p className="mt-3 text-base leading-relaxed text-soil-600">{t('quality.subtitle')}</p>
      </header>

      <Notice tone="warning" className="mx-auto mt-6 max-w-3xl" title="What we do not claim">
        {t('quality.aiLimits')}
      </Notice>

      <section className="mt-12" aria-labelledby="statuses">
        <h2 id="statuses" className="text-2xl font-bold text-soil-900">
          The five quality statuses
        </h2>
        <ul className="mt-5 grid gap-4 lg:grid-cols-2">
          {statuses.map((status) => (
            <li key={status.label}>
              <Card className="h-full">
                <CardBody>
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-soil-100 text-soil-700">
                      <status.icon className="size-5" aria-hidden="true" />
                    </span>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-soil-600">{status.body}</p>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12" aria-labelledby="trust">
        <h2 id="trust" className="text-2xl font-bold text-soil-900">
          Four separate kinds of trust
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-soil-600">
          {t('quality.distinctNote')}
        </p>
        <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {trustLevels.map((level) => (
            <li key={level.label}>
              <Card className="h-full">
                <CardBody>
                  <level.icon className="size-6 text-leaf-700" aria-hidden="true" />
                  <h3 className="mt-3 font-bold text-soil-900">{level.label}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-soil-600">{level.body}</p>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12" aria-labelledby="integration-status">
        <h2 id="integration-status" className="text-2xl font-bold text-soil-900">
          What is configured on this installation
        </h2>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardBody>
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-bold text-soil-900">AI-assisted image assessment</h3>
                {aiStatus.loading ? (
                  <Spinner />
                ) : aiStatus.data?.enabled ? (
                  <Badge tone="success">{t('admin.configured')}</Badge>
                ) : (
                  <Badge tone="neutral">{t('admin.notConfigured')}</Badge>
                )}
              </div>
              <p className="mt-2 text-sm leading-relaxed text-soil-600">
                {aiStatus.data?.enabled
                  ? 'Farmers and customers can submit a crop photograph for a preliminary visual check.'
                  : t('quality.aiNotConfigured')}
              </p>
              <p className="mt-3 rounded-[var(--radius-control)] bg-sky-50 p-3 text-xs leading-relaxed text-sky-900">
                {t('quality.aiDisclaimer')}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-bold text-soil-900">Official market price data</h3>
                {marketStatus.loading ? (
                  <Spinner />
                ) : marketStatus.data?.configured ? (
                  <Badge tone="success">{t('admin.configured')}</Badge>
                ) : (
                  <Badge tone="neutral">{t('admin.notConfigured')}</Badge>
                )}
              </div>
              <p className="mt-2 text-sm leading-relaxed text-soil-600">
                {marketStatus.data?.message ??
                  t('market.notConfiguredHelp')}
              </p>
            </CardBody>
          </Card>
        </div>

        {standards.data && (
          <Card className="mt-4">
            <CardBody>
              <h3 className="font-bold text-soil-900">Standards this platform applies</h3>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed text-soil-600">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-leaf-700" aria-hidden="true" />
                  A crop is never marked laboratory-tested, certified organic, or officially
                  inspected without a document a reviewer has approved.
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-leaf-700" aria-hidden="true" />
                  Only authorized reviewers can change a verification status, and every change is
                  recorded in the audit log.
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-leaf-700" aria-hidden="true" />
                  A farmer&rsquo;s selling price is never altered by the platform, by translation, or
                  by any market comparison.
                </li>
                <li className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden="true" />
                  Anyone can report a suspected quality problem, and reports are reviewed by a
                  person.
                </li>
              </ul>
            </CardBody>
          </Card>
        )}
      </section>

      <div className="mt-10 flex flex-wrap gap-3">
        <a href="/explore">
          <Button>{t('landing.browseCrops')}</Button>
        </a>
        <a href="/help">
          <Button variant="outline">{t('footer.helpCentre')}</Button>
        </a>
      </div>
    </div>
  );
}
