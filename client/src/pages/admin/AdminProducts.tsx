import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Flag, Package } from 'lucide-react';
import { RoleShell } from '@/components/layout/RoleShell';
import { useAsync, useDebounced } from '@/hooks/useCart';
import { admin as adminApi } from '@/lib/services';
import { messageOf } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, EmptyState, ErrorState, Notice, Spinner } from '@/components/ui/Card';
import { Select, TextInput } from '@/components/ui/Field';
import { Pagination } from '@/components/ui/Pagination';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/Modal';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { formatDate, formatINR, unitLabel } from '@/lib/format';
import type { ProductUnit } from '@/lib/types';

interface AdminProduct {
  id: string;
  name: string;
  variety: string | null;
  price: number;
  unit: ProductUnit;
  stock_quantity: number;
  status: string;
  grade: string;
  is_flagged: boolean;
  created_at: string;
  state: string;
  district: string;
  category_name: string | null;
  farmer_id: string;
  farmer_name: string;
  farmer_verification: string;
}

/**
 * Listing moderation.
 *
 * Flagging a listing hides it from the public catalogue without deleting the
 * farmer's work — reversible, and recorded in the audit log.
 */
export default function AdminProducts() {
  const { t } = useTranslation();
  useDocumentTitle(t('admin.products'));

  const [search, setSearch] = useState('');
  const [flaggedOnly, setFlaggedOnly] = useState('');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingFlag, setPendingFlag] = useState<AdminProduct | null>(null);

  const debouncedSearch = useDebounced(search);

  const result = useAsync(
    (signal) =>
      adminApi.products(
        {
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
          ...(flaggedOnly ? { flagged: flaggedOnly === '1' } : {}),
          page,
        },
        signal,
      ),
    [debouncedSearch, flaggedOnly, page],
  );

  const toggleFlag = async (product: AdminProduct) => {
    setBusyId(product.id);
    setError(null);
    try {
      await adminApi.flagProduct(product.id, { flagged: !product.is_flagged });
      result.reload();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusyId(null);
    }
  };

  const items = (result.data?.items ?? []) as unknown as AdminProduct[];

  return (
    <RoleShell role="admin" title={t('admin.products')}>
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
                name="flagged"
                label={t('common.filter')}
                value={flaggedOnly}
                onChange={(event) => {
                  setFlaggedOnly(event.target.value);
                  setPage(1);
                }}
                options={[
                  { value: '', label: t('common.clearAll') },
                  { value: '1', label: t('admin.flagProduct') },
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
            icon={<Package className="size-6" aria-hidden="true" />}
            title={t('common.noData')}
            description={t('admin.products')}
          />
        )}

        {items.length > 0 && (
          <Card>
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-soil-50 text-left text-xs uppercase text-soil-600">
                    <tr>
                      <th className="px-5 py-2.5">{t('farmer.productName')}</th>
                      <th className="px-5 py-2.5">{t('product.farmer')}</th>
                      <th className="px-5 py-2.5">{t('farmer.pricePerUnit')}</th>
                      <th className="px-5 py-2.5">{t('farmer.stock')}</th>
                      <th className="px-5 py-2.5">{t('common.profile')}</th>
                      <th className="px-5 py-2.5">{t('order.placedOn')}</th>
                      <th className="px-5 py-2.5">{t('common.edit')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-soil-100">
                    {items.map((product) => (
                      <tr key={product.id} className={product.is_flagged ? 'bg-amber-50/40' : undefined}>
                        <td className="px-5 py-2.5">
                          <Link
                            to={`/products/${product.id}`}
                            className="font-medium text-soil-900 hover:text-leaf-800 hover:underline"
                          >
                            {product.name}
                          </Link>
                          {product.variety && (
                            <span className="block text-xs text-soil-500">{product.variety}</span>
                          )}
                          {product.is_flagged && (
                            <Badge tone="warning" className="mt-1">
                              {t('admin.flagProduct')}
                            </Badge>
                          )}
                        </td>
                        <td className="px-5 py-2.5 text-soil-700">{product.farmer_name}</td>
                        <td className="tabular px-5 py-2.5">
                          {formatINR(product.price)}
                          <span className="block text-xs text-soil-500">
                            {unitLabel(product.unit, null)}
                          </span>
                        </td>
                        <td className="tabular px-5 py-2.5">{product.stock_quantity}</td>
                        <td className="px-5 py-2.5">
                          <Badge tone="neutral">{product.status}</Badge>
                        </td>
                        <td className="px-5 py-2.5 text-soil-600">{formatDate(product.created_at)}</td>
                        <td className="px-5 py-2.5">
                          <Button
                            size="sm"
                            variant={product.is_flagged ? 'outline' : 'ghost'}
                            loading={busyId === product.id}
                            onClick={() =>
                              product.is_flagged ? void toggleFlag(product) : setPendingFlag(product)
                            }
                          >
                            <Flag className="size-4" aria-hidden="true" />
                            {product.is_flagged ? t('admin.dismiss') : t('admin.flagProduct')}
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
        open={pendingFlag !== null}
        onClose={() => setPendingFlag(null)}
        onConfirm={async () => {
          const product = pendingFlag;
          setPendingFlag(null);
          if (product) await toggleFlag(product);
        }}
        title={t('admin.flagProduct')}
        description={pendingFlag?.name}
        confirmLabel={t('admin.flagProduct')}
      />
    </RoleShell>
  );
}
