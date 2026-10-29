import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Package, Pencil, PlusCircle, Search } from 'lucide-react';
import { RoleShell } from '@/components/layout/RoleShell';
import { useAsync, useDebounced } from '@/hooks/useCart';
import { products as productsApi } from '@/lib/services';
import { messageOf } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, EmptyState, ErrorState, Notice, ProductGridSkeleton } from '@/components/ui/Card';
import { Select, TextInput } from '@/components/ui/Field';
import { Pagination } from '@/components/ui/Pagination';
import { ConfirmDialog } from '@/components/ui/Modal';
import { ProductCard } from '@/components/marketplace/ProductCard';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import type { ProductStatus } from '@/lib/types';

const STATUS_OPTIONS: ProductStatus[] = ['active', 'draft', 'out_of_stock', 'inactive'];

/**
 * The farmer's own listings.
 *
 * Uses `/api/products/mine` rather than the public catalogue, because a draft
 * or an inactive listing is deliberately absent from the public view and would
 * otherwise be invisible to the person who created it.
 */
export default function FarmerProducts() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  useDocumentTitle(t('nav.myProducts'));

  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const debouncedSearch = useDebounced(search);

  const result = useAsync(
    (signal) =>
      productsApi.mine(
        {
          ...(status ? { status } : {}),
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
          page,
        },
        signal,
      ),
    [status, debouncedSearch, page],
  );

  const setListingStatus = async (id: string, next: string) => {
    setBusyId(id);
    setError(null);
    try {
      await productsApi.setStatus(id, next);
      result.reload();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusyId(null);
    }
  };

  const items = result.data?.items ?? [];

  return (
    <RoleShell
      role="farmer"
      title={t('nav.myProducts')}
      headerAction={
        <Button onClick={() => navigate('/farmer/products/new')}>
          <PlusCircle className="size-4" aria-hidden="true" />
          {t('nav.addCrop')}
        </Button>
      }
    >
      <div className="space-y-5">
        <Card>
          <CardBody className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1">
              <TextInput
                name="search"
                label={t('common.search')}
                placeholder={t('landing.searchPlaceholder')}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div className="w-48">
              <Select
                name="status"
                label={t('common.filter')}
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
                options={[
                  { value: '', label: t('common.clearAll') },
                  ...STATUS_OPTIONS.map((value) => ({ value, label: value.replace(/_/g, ' ') })),
                ]}
              />
            </div>
          </CardBody>
        </Card>

        {error && <Notice tone="danger">{error}</Notice>}

        {result.loading && <ProductGridSkeleton count={4} />}

        {!result.loading && result.error && (
          <ErrorState message={result.error} onRetry={result.reload} />
        )}

        {!result.loading && !result.error && items.length === 0 && (
          <EmptyState
            icon={<Package className="size-6" aria-hidden="true" />}
            title={t('farmer.noListings')}
            description={t('farmer.addCropSub')}
            action={
              <Button onClick={() => navigate('/farmer/products/new')}>
                <PlusCircle className="size-4" aria-hidden="true" />
                {t('farmer.addFirstCrop')}
              </Button>
            }
          />
        )}

        {items.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((product) => (
              <div key={product.id} className="space-y-2">
                <ProductCard product={product} />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`/farmer/products/${product.id}/edit`)}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                    {t('common.edit')}
                  </Button>

                  {product.status === 'active' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      loading={busyId === product.id}
                      onClick={() => void setListingStatus(product.id, 'out_of_stock')}
                    >
                      {t('farmer.markOutOfStock')}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      loading={busyId === product.id}
                      onClick={() => void setListingStatus(product.id, 'active')}
                    >
                      {t('farmer.publish')}
                    </Button>
                  )}

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPendingDelete(product.id)}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {result.data && result.data.total_pages > 1 && (
          <Pagination page={page} totalPages={result.data.total_pages} onPageChange={setPage} />
        )}

        <p className="flex items-center gap-1.5 text-xs text-soil-500">
          <Search className="size-3.5" aria-hidden="true" />
          Showing {items.length} of {result.data?.total ?? 0} listings.
        </p>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          const id = pendingDelete;
          setPendingDelete(null);
          if (!id) return;
          setBusyId(id);
          try {
            await productsApi.remove(id);
            result.reload();
          } catch (caught) {
            setError(messageOf(caught));
          } finally {
            setBusyId(null);
          }
        }}
        title={t('farmer.deleteListing')}
        description={t('farmer.deleteConfirm')}
        confirmLabel={t('common.delete')}
      />
    </RoleShell>
  );
}
