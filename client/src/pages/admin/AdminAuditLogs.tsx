import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollText } from 'lucide-react';
import { RoleShell } from '@/components/layout/RoleShell';
import { useAsync } from '@/hooks/useCart';
import { admin as adminApi } from '@/lib/services';
import { Card, CardBody, EmptyState, ErrorState, Notice, Spinner } from '@/components/ui/Card';
import { Pagination } from '@/components/ui/Pagination';
import { Badge } from '@/components/ui/Badge';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { formatDateTime } from '@/lib/format';
import type { AuditLog } from '@/lib/types';

interface AuditRow extends Omit<AuditLog, 'before' | 'after'> {
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  actor_role: string | null;
  actor_email: string | null;
}

/**
 * The audit log.
 *
 * Append-only by construction: the table has no update or delete policy for any
 * role, so an administrator cannot quietly erase their own trail. This screen
 * only reads it.
 */
export default function AdminAuditLogs() {
  const { t } = useTranslation();
  useDocumentTitle(t('admin.auditLogs'));

  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const result = useAsync((signal) => adminApi.auditLogs({ page }, signal), [page]);
  const items = (result.data?.items ?? []) as unknown as AuditRow[];

  return (
    <RoleShell role="admin" title={t('admin.auditLogs')}>
      <div className="space-y-5">
        <Notice tone="info" title={t('admin.auditHelp')}>
          {t('admin.auditHelp')}
        </Notice>

        {result.loading && <Spinner />}
        {!result.loading && result.error && (
          <ErrorState message={result.error} onRetry={result.reload} />
        )}

        {!result.loading && !result.error && items.length === 0 && (
          <EmptyState
            icon={<ScrollText className="size-6" aria-hidden="true" />}
            title={t('common.noData')}
            description={t('admin.auditHelp')}
          />
        )}

        {items.length > 0 && (
          <Card>
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-soil-50 text-left text-xs uppercase text-soil-600">
                    <tr>
                      <th className="px-5 py-2.5">{t('market.observedOn')}</th>
                      <th className="px-5 py-2.5">{t('common.profile')}</th>
                      <th className="px-5 py-2.5">{t('common.settings')}</th>
                      <th className="px-5 py-2.5">{t('admin.reviewNote')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-soil-100">
                    {items.map((entry) => (
                      <tr key={String(entry.id)}>
                        <td className="px-5 py-2.5 whitespace-nowrap text-soil-600">
                          {formatDateTime(entry.created_at)}
                        </td>
                        <td className="px-5 py-2.5">
                          <span className="font-medium text-soil-900">
                            {entry.actor_name ?? '—'}
                          </span>
                          {entry.actor_role && (
                            <Badge tone="neutral" className="ml-2">
                              {entry.actor_role}
                            </Badge>
                          )}
                        </td>
                        <td className="px-5 py-2.5">
                          <span className="font-medium text-soil-900">{entry.action}</span>
                          <span className="block text-xs text-soil-500">
                            {entry.entity_type}
                            {entry.entity_id ? ` · ${entry.entity_id.slice(0, 8)}` : ''}
                          </span>
                        </td>
                        <td className="px-5 py-2.5">
                          {(entry.before_data || entry.after_data) && (
                            <button
                              type="button"
                              className="text-xs font-semibold text-leaf-700 hover:underline"
                              onClick={() =>
                                setExpanded(expanded === entry.id ? null : entry.id)
                              }
                            >
                              {expanded === entry.id ? t('common.close') : t('common.seeMore')}
                            </button>
                          )}
                          {expanded === entry.id && (
                            <pre className="mt-2 max-w-md overflow-x-auto rounded bg-soil-50 p-2 text-xs text-soil-700">
                              {JSON.stringify(
                                { before: entry.before_data, after: entry.after_data },
                                null,
                                2,
                              )}
                            </pre>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        )}

        {result.data && result.data.total_pages > 1 && (
          <Pagination page={page} totalPages={result.data.total_pages} onPageChange={setPage} />
        )}
      </div>
    </RoleShell>
  );
}
