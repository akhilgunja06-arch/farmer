import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';
import { RoleShell } from '@/components/layout/RoleShell';
import { useAsync, useDebounced } from '@/hooks/useCart';
import { admin as adminApi } from '@/lib/services';
import { messageOf } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, EmptyState, ErrorState, Notice, Spinner } from '@/components/ui/Card';
import { Select, TextInput } from '@/components/ui/Field';
import { Pagination } from '@/components/ui/Pagination';
import { Badge, VerificationBadge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/Modal';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { formatDate } from '@/lib/format';
import type { VerificationStatus } from '@/lib/types';

interface AdminUser {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: string;
  is_suspended: boolean;
  suspended_reason: string | null;
  email_verified: boolean;
  identity_verified: boolean;
  created_at: string;
  farmer_verification: VerificationStatus | null;
  state: string | null;
  district: string | null;
  listing_count: number;
  order_count: number;
}

/**
 * User management.
 *
 * Suspension and role changes both go through admin-only endpoints that write
 * an audit row. The role selector deliberately cannot grant `admin` from this
 * screen unless the server allows it — the API is the authority, not the
 * dropdown.
 */
export default function AdminUsers() {
  const { t } = useTranslation();
  useDocumentTitle(t('admin.users'));

  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingSuspend, setPendingSuspend] = useState<AdminUser | null>(null);

  const debouncedSearch = useDebounced(search);

  const result = useAsync(
    (signal) =>
      adminApi.users(
        {
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
          ...(role ? { role } : {}),
          page,
        },
        signal,
      ),
    [debouncedSearch, role, page],
  );

  const setSuspension = async (user: AdminUser, suspended: boolean) => {
    setBusyId(user.id);
    setError(null);
    try {
      await adminApi.setSuspension(user.id, suspended);
      result.reload();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusyId(null);
    }
  };

  const items = (result.data?.items ?? []) as unknown as AdminUser[];

  return (
    <RoleShell role="admin" title={t('admin.users')}>
      <div className="space-y-5">
        <Card>
          <CardBody className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1">
              <TextInput
                name="search"
                label={t('common.search')}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div className="w-44">
              <Select
                name="role"
                label={t('admin.changeRole')}
                value={role}
                onChange={(event) => {
                  setRole(event.target.value);
                  setPage(1);
                }}
                options={[
                  { value: '', label: t('common.clearAll') },
                  { value: 'farmer', label: t('admin.farmers') },
                  { value: 'customer', label: t('admin.registeredCustomers') },
                  { value: 'admin', label: t('auth.adminCard') },
                ]}
              />
            </div>
          </CardBody>
        </Card>

        {error && <Notice tone="danger">{error}</Notice>}

        {result.loading && <Spinner />}
        {!result.loading && result.error && (
          <ErrorState message={result.error} onRetry={result.reload} />
        )}

        {!result.loading && !result.error && items.length === 0 && (
          <EmptyState
            icon={<Users className="size-6" aria-hidden="true" />}
            title={t('common.noData')}
            description={t('common.results')}
          />
        )}

        {items.length > 0 && (
          <Card>
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-soil-50 text-left text-xs uppercase text-soil-600">
                    <tr>
                      <th className="px-5 py-2.5">{t('auth.fullName')}</th>
                      <th className="px-5 py-2.5">{t('auth.email')}</th>
                      <th className="px-5 py-2.5">{t('common.profile')}</th>
                      <th className="px-5 py-2.5">{t('farmer.verification')}</th>
                      <th className="px-5 py-2.5">{t('order.placedOn')}</th>
                      <th className="px-5 py-2.5">{t('common.edit')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-soil-100">
                    {items.map((user) => (
                      <tr key={user.id} className={user.is_suspended ? 'bg-red-50/40' : undefined}>
                        <td className="px-5 py-2.5">
                          <span className="font-medium text-soil-900">{user.full_name}</span>
                          {user.is_suspended && (
                            <Badge tone="danger" className="ml-2">
                              {t('admin.suspendedAccounts')}
                            </Badge>
                          )}
                        </td>
                        <td className="px-5 py-2.5 text-soil-700">{user.email}</td>
                        <td className="px-5 py-2.5">
                          <Badge tone="neutral">{user.role}</Badge>
                        </td>
                        <td className="px-5 py-2.5">
                          {user.farmer_verification ? (
                            <VerificationBadge status={user.farmer_verification} />
                          ) : (
                            <span className="text-soil-400">—</span>
                          )}
                        </td>
                        <td className="px-5 py-2.5 text-soil-600">{formatDate(user.created_at)}</td>
                        <td className="px-5 py-2.5">
                          <Button
                            size="sm"
                            variant={user.is_suspended ? 'outline' : 'ghost'}
                            loading={busyId === user.id}
                            onClick={() =>
                              user.is_suspended
                                ? void setSuspension(user, false)
                                : setPendingSuspend(user)
                            }
                          >
                            {user.is_suspended ? t('admin.unsuspendUser') : t('admin.suspendUser')}
                          </Button>
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

      <ConfirmDialog
        open={pendingSuspend !== null}
        onClose={() => setPendingSuspend(null)}
        onConfirm={async () => {
          const user = pendingSuspend;
          setPendingSuspend(null);
          if (user) await setSuspension(user, true);
        }}
        title={t('admin.suspendConfirm')}
        description={pendingSuspend?.email}
        confirmLabel={t('admin.suspendUser')}
      />
    </RoleShell>
  );
}
