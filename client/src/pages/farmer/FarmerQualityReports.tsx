import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileCheck2, FlaskConical, Send, ShieldCheck } from 'lucide-react';
import { RoleShell } from '@/components/layout/RoleShell';
import { useAsync } from '@/hooks/useCart';
import { api, messageOf } from '@/lib/api';
import { quality as qualityApi } from '@/lib/services';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, EmptyState, ErrorState, Notice, Spinner } from '@/components/ui/Card';
import { Badge, VerificationBadge } from '@/components/ui/Badge';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { formatDate } from '@/lib/format';
import type { QualityReport, VerificationStatus } from '@/lib/types';

interface MineResponse {
  reports: Array<QualityReport & { product_name: string | null; review_note: string | null }>;
  ai_disclaimer: string;
}

/**
 * The farmer's own quality reports.
 *
 * A farmer can submit information and ask for a review, but cannot set the
 * verification status themselves — the database refuses that outside a
 * privileged reviewer context. The page shows the status as read-only for
 * exactly that reason.
 */
export default function FarmerQualityReports() {
  const { t } = useTranslation();
  useDocumentTitle(t('nav.qualityReports'));

  const result = useAsync((signal) => api.get<MineResponse>('/api/quality/reports/mine', undefined, signal), []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<string | null>(null);

  const requestReview = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await api.post(`/api/quality/reports/${id}/request-review`);
      setSent(id);
      result.reload();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusyId(null);
    }
  };

  const checkAi = async () => {
    setError(null);
    try {
      const status = await qualityApi.aiStatus();
      setAiStatus(status.enabled ? 'enabled' : status.disclaimer);
    } catch (caught) {
      setError(messageOf(caught));
    }
  };

  const reports = result.data?.reports ?? [];

  return (
    <RoleShell role="farmer" title={t('nav.qualityReports')}>
      <div className="space-y-5">
        <Notice tone="info" title={t('quality.title')}>
          {t('quality.distinctNote')}
        </Notice>

        {error && <Notice tone="danger">{error}</Notice>}
        {sent && <Notice tone="success">{t('quality.issueSubmitted')}</Notice>}

        <Card>
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 font-bold text-soil-900">
                <FlaskConical className="size-4" aria-hidden="true" />
                {t('quality.aiAssessed')}
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-soil-600">{t('quality.aiLimits')}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void checkAi()}>
              {t('common.viewDetails')}
            </Button>
          </CardBody>
          {aiStatus && (
            <CardBody className="border-t border-soil-100 pt-4">
              <Notice tone="warning">{aiStatus}</Notice>
              <p className="mt-2 text-xs text-soil-600">{t('quality.aiDisclaimer')}</p>
            </CardBody>
          )}
        </Card>

        {result.loading && <Spinner />}
        {!result.loading && result.error && (
          <ErrorState message={result.error} onRetry={result.reload} />
        )}

        {!result.loading && !result.error && reports.length === 0 && (
          <EmptyState
            icon={<FileCheck2 className="size-6" aria-hidden="true" />}
            title={t('quality.inspectionPending')}
            description="Attach quality information to one of your listings and it will appear here."
          />
        )}

        {reports.length > 0 && (
          <div className="space-y-3">
            {reports.map((report) => (
              <Card key={report.id}>
                <CardBody className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-bold text-soil-900">
                        {report.title ?? report.product_name ?? t('nav.qualityReports')}
                      </h3>
                      <p className="text-xs text-soil-600">
                        {report.product_name} · {formatDate(report.created_at)}
                      </p>
                    </div>
                    <VerificationBadge status={report.verification_status as VerificationStatus} />
                  </div>

                  {report.summary && <p className="text-sm text-soil-700">{report.summary}</p>}

                  <div className="flex flex-wrap gap-2">
                    <Badge tone="neutral">{report.report_type.replace(/_/g, ' ')}</Badge>
                    {report.inspection_provider && (
                      <Badge tone="info">{report.inspection_provider}</Badge>
                    )}
                    {report.inspection_date && (
                      <Badge tone="neutral">
                        {t('market.observedOn')} {formatDate(report.inspection_date)}
                      </Badge>
                    )}
                  </div>

                  {report.review_note && (
                    <Notice tone="info" title={t('admin.reviewNote')}>
                      {report.review_note}
                    </Notice>
                  )}

                  {report.verification_status === 'unverified' && (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={busyId === report.id}
                      onClick={() => void requestReview(report.id)}
                    >
                      <Send className="size-4" aria-hidden="true" />
                      {t('farmer.requestVerification')}
                    </Button>
                  )}

                  {report.verification_status === 'pending' && (
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                      <ShieldCheck className="size-3.5" aria-hidden="true" />
                      {t('quality.inspectionPending')}
                    </p>
                  )}
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </div>
    </RoleShell>
  );
}
