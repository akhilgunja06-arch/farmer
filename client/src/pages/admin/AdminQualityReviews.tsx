import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileCheck2, ShieldCheck } from 'lucide-react';
import { RoleShell } from '@/components/layout/RoleShell';
import { useAsync } from '@/hooks/useCart';
import { admin as adminApi } from '@/lib/services';
import { messageOf } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, EmptyState, ErrorState, Notice, Spinner } from '@/components/ui/Card';
import { TextArea } from '@/components/ui/Field';
import { Pagination } from '@/components/ui/Pagination';
import { Badge, VerificationBadge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { formatDate } from '@/lib/format';
import type { VerificationStatus } from '@/lib/types';

interface QualityReportRow {
  id: string;
  product_id: string;
  report_type: string;
  title: string | null;
  summary: string | null;
  measurements: Record<string, unknown> | null;
  report_document: string | null;
  inspection_provider: string | null;
  inspection_date: string | null;
  inspector_name: string | null;
  verification_status: VerificationStatus;
  expiry_date: string | null;
  review_note: string | null;
  created_at: string;
  product_name: string;
  submitted_by_name: string;
}

/**
 * Quality report review.
 *
 * This is the only place a verification status can be changed. The database
 * refuses an update to that column outside a reviewer context, so the control
 * existing here is not the protection — the protection is underneath it.
 *
 * Approving a report asserts that the attached document was reviewed. It does
 * not assert food safety, residues, or nutrition, and the copy avoids implying
 * otherwise.
 */
export default function AdminQualityReviews() {
  const { t } = useTranslation();
  useDocumentTitle(t('admin.qualityReviews'));

  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<QualityReportRow | null>(null);
  const [note, setNote] = useState('');

  const result = useAsync((signal) => adminApi.qualityReports({ page }, signal), [page]);

  const decide = async (status: string) => {
    if (!reviewing) return;
    setBusyId(reviewing.id);
    setError(null);
    try {
      await adminApi.reviewQualityReport(reviewing.id, { status, ...(note ? { note } : {}) });
      setReviewing(null);
      setNote('');
      result.reload();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusyId(null);
    }
  };

  const items = (result.data?.items ?? []) as unknown as QualityReportRow[];

  return (
    <RoleShell role="admin" title={t('admin.qualityReviews')}>
      <div className="space-y-5">
        <Notice tone="info" title={t('quality.title')}>
          {t('quality.distinctNote')}
        </Notice>

        {error && <Notice tone="danger">{error}</Notice>}

        {result.loading && <Spinner />}
        {!result.loading && result.error && (
          <ErrorState message={result.error} onRetry={result.reload} />
        )}

        {!result.loading && !result.error && items.length === 0 && (
          <EmptyState
            icon={<FileCheck2 className="size-6" aria-hidden="true" />}
            title={t('quality.inspectionPending')}
            description={t('quality.inspectionDocs')}
          />
        )}

        {items.length > 0 && (
          <div className="space-y-3">
            {items.map((report) => (
              <Card key={report.id}>
                <CardBody className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-bold text-soil-900">
                      {report.title ?? report.product_name}
                    </p>
                    <p className="text-sm text-soil-600">
                      {report.product_name} · {report.submitted_by_name}
                    </p>
                    <p className="text-xs text-soil-500">
                      {formatDate(report.created_at)}
                      {report.inspection_date ? ` · ${formatDate(report.inspection_date)}` : ''}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge tone="neutral">{report.report_type.replace(/_/g, ' ')}</Badge>
                      {report.inspection_provider && (
                        <Badge tone="info">{report.inspection_provider}</Badge>
                      )}
                      {report.report_document && (
                        <Badge tone="leaf">{t('quality.inspectionDocs')}</Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <VerificationBadge status={report.verification_status} />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setReviewing(report);
                        setNote(report.review_note ?? '');
                      }}
                    >
                      <ShieldCheck className="size-4" aria-hidden="true" />
                      {t('common.viewDetails')}
                    </Button>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}

        {result.data && result.data.total_pages > 1 && (
          <Pagination page={page} totalPages={result.data.total_pages} onPageChange={setPage} />
        )}
      </div>

      <Modal
        open={reviewing !== null}
        onClose={() => setReviewing(null)}
        title={t('admin.qualityReviews')}
        description={reviewing?.product_name}
        size="lg"
        footer={
          <>
            <Button
              variant="outline"
              loading={busyId === reviewing?.id}
              onClick={() => void decide('rejected')}
            >
              {t('admin.reject')}
            </Button>
            <Button loading={busyId === reviewing?.id} onClick={() => void decide('verified')}>
              {t('admin.approve')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {reviewing?.summary && (
            <p className="text-sm leading-relaxed text-soil-700">{reviewing.summary}</p>
          )}

          {reviewing?.measurements && (
            <div className="rounded-[var(--radius-control)] border border-soil-200 p-3 text-sm">
              {Object.entries(reviewing.measurements).map(([key, value]) => (
                <div key={key} className="flex justify-between gap-3">
                  <span className="text-soil-600">{key.replace(/_/g, ' ')}</span>
                  <span className="tabular font-medium text-soil-900">{String(value)}</span>
                </div>
              ))}
            </div>
          )}

          {reviewing?.report_document ? (
            <a
              href={reviewing.report_document}
              target="_blank"
              rel="noreferrer noopener"
              className="text-sm font-semibold text-leaf-700 underline underline-offset-4"
            >
              {t('quality.inspectionDocs')}
            </a>
          ) : (
            <Notice tone="warning">{t('product.noInspection')}</Notice>
          )}

          <Notice tone="info">{t('quality.aiLimits')}</Notice>

          <TextArea
            name="note"
            label={t('admin.reviewNote')}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
      </Modal>
    </RoleShell>
  );
}
