import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flag } from 'lucide-react';
import { RoleShell } from '@/components/layout/RoleShell';
import { useAsync } from '@/hooks/useCart';
import { admin as adminApi } from '@/lib/services';
import { messageOf } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, EmptyState, ErrorState, Notice, Spinner } from '@/components/ui/Card';
import { TextArea } from '@/components/ui/Field';
import { Pagination } from '@/components/ui/Pagination';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { formatDate } from '@/lib/format';

interface UserReport {
  id: string;
  reporter_name: string;
  target_type: string;
  target_id: string;
  reason: string;
  details: string | null;
  status: string;
  resolution: string | null;
  created_at: string;
}

/**
 * Reported listings, reviews, users and messages.
 *
 * A report is a claim, not a finding. Resolving one records the decision and a
 * note; dismissing one leaves the content in place. Either way the action is
 * audited.
 */
export default function AdminReports() {
  const { t } = useTranslation();
  useDocumentTitle(t('admin.reports'));

  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<UserReport | null>(null);
  const [note, setNote] = useState('');

  const result = useAsync((signal) => adminApi.reports({ page }, signal), [page]);

  const decide = async (status: string) => {
    if (!reviewing) return;
    setBusyId(reviewing.id);
    setError(null);
    try {
      await adminApi.reviewReport(reviewing.id, { status, ...(note ? { note } : {}) });
      setReviewing(null);
      setNote('');
      result.reload();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusyId(null);
    }
  };

  const items = (result.data?.items ?? []) as unknown as UserReport[];

  return (
    <RoleShell role="admin" title={t('admin.reports')}>
      <div className="space-y-5">
        {error && <Notice tone="danger">{error}</Notice>}

        {result.loading && <Spinner />}
        {!result.loading && result.error && (
          <ErrorState message={result.error} onRetry={result.reload} />
        )}

        {!result.loading && !result.error && items.length === 0 && (
          <EmptyState
            icon={<Flag className="size-6" aria-hidden="true" />}
            title={t('admin.openReports')}
            description={t('admin.auditHelp')}
          />
        )}

        {items.length > 0 && (
          <div className="space-y-3">
            {items.map((report) => (
              <Card key={report.id}>
                <CardBody className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-bold text-soil-900">{report.reason}</p>
                    <p className="text-sm text-soil-600">
                      {report.reporter_name} · {report.target_type}
                    </p>
                    <p className="text-xs text-soil-500">{formatDate(report.created_at)}</p>
                    {report.details && (
                      <p className="mt-1 text-sm text-soil-700">{report.details}</p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={
                        report.status === 'resolved'
                          ? 'success'
                          : report.status === 'under_review'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {report.status}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setReviewing(report);
                        setNote(report.resolution ?? '');
                      }}
                    >
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
        title={t('admin.reports')}
        description={reviewing?.reason}
        footer={
          <>
            <Button
              variant="outline"
              loading={busyId === reviewing?.id}
              onClick={() => void decide('dismissed')}
            >
              {t('admin.dismiss')}
            </Button>
            <Button loading={busyId === reviewing?.id} onClick={() => void decide('resolved')}>
              {t('admin.resolved')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {reviewing?.details && <p className="text-sm text-soil-700">{reviewing.details}</p>}
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
