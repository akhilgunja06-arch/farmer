import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sprout } from 'lucide-react';
import { RoleShell } from '@/components/layout/RoleShell';
import { useAsync } from '@/hooks/useCart';
import { admin as adminApi } from '@/lib/services';
import { messageOf } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, EmptyState, ErrorState, Notice, Spinner } from '@/components/ui/Card';
import { TextArea } from '@/components/ui/Field';
import { Pagination } from '@/components/ui/Pagination';
import { VerificationBadge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { formatDate } from '@/lib/format';
import type { VerificationStatus } from '@/lib/types';

interface VerificationRequest {
  id: string;
  user_id: string;
  farmer_name: string;
  farm_name: string | null;
  state: string | null;
  district: string | null;
  status: string;
  documents: unknown;
  note: string | null;
  created_at: string;
}

/**
 * Farmer verification requests.
 *
 * Approving one changes a farmer's public badge, so the decision is recorded
 * with a note and an audit entry. Nothing here can be done by a non-admin —
 * the endpoint checks the role and RLS backs it up.
 */
export default function AdminFarmers() {
  const { t } = useTranslation();
  useDocumentTitle(t('admin.farmers'));

  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<VerificationRequest | null>(null);
  const [note, setNote] = useState('');

  const result = useAsync(
    (signal) => adminApi.verificationRequests({ page }, signal),
    [page],
  );

  const decide = async (status: 'approved' | 'rejected') => {
    if (!reviewing) return;
    setBusyId(reviewing.id);
    setError(null);
    try {
      await adminApi.reviewVerification(reviewing.id, { status, ...(note ? { note } : {}) });
      setReviewing(null);
      setNote('');
      result.reload();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusyId(null);
    }
  };

  const items = (result.data?.items ?? []) as unknown as VerificationRequest[];

  return (
    <RoleShell role="admin" title={t('admin.farmers')}>
      <div className="space-y-5">
        {error && <Notice tone="danger">{error}</Notice>}

        {result.loading && <Spinner />}
        {!result.loading && result.error && (
          <ErrorState message={result.error} onRetry={result.reload} />
        )}

        {!result.loading && !result.error && items.length === 0 && (
          <EmptyState
            icon={<Sprout className="size-6" aria-hidden="true" />}
            title={t('admin.pendingVerifications')}
            description={t('farmer.verificationHelp')}
          />
        )}

        {items.length > 0 && (
          <div className="space-y-3">
            {items.map((request) => (
              <Card key={request.id}>
                <CardBody className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-bold text-soil-900">{request.farmer_name}</p>
                    <p className="text-sm text-soil-600">
                      {request.farm_name ?? '—'}
                      {request.district ? ` · ${request.district}, ${request.state}` : ''}
                    </p>
                    <p className="text-xs text-soil-500">{formatDate(request.created_at)}</p>
                    {request.note && (
                      <p className="mt-1 text-xs text-soil-600">{request.note}</p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <VerificationBadge status={request.status as VerificationStatus} />
                    <Button
                      size="sm"
                      onClick={() => {
                        setReviewing(request);
                        setNote('');
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
        title={t('farmer.verification')}
        description={reviewing?.farmer_name}
        footer={
          <>
            <Button
              variant="outline"
              loading={busyId === reviewing?.id}
              onClick={() => void decide('rejected')}
            >
              {t('admin.reject')}
            </Button>
            <Button loading={busyId === reviewing?.id} onClick={() => void decide('approved')}>
              {t('admin.approve')}
            </Button>
          </>
        }
      >
        <TextArea
          name="note"
          label={t('admin.reviewNote')}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Modal>
    </RoleShell>
  );
}
