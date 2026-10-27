import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bookmark, ShoppingCart, Trash2 } from 'lucide-react';
import { RoleShell } from '@/components/layout/RoleShell';
import { useAsync, bumpCartCount } from '@/hooks/useCart';
import { cart as cartApi, saved as savedApi } from '@/lib/services';
import { messageOf } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, Notice, ProductGridSkeleton } from '@/components/ui/Card';
import { ProductCard } from '@/components/marketplace/ProductCard';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import type { ProductSummary } from '@/lib/types';

/** Saved products. The rows come from the customer's own saved list. */
export default function CustomerSaved() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  useDocumentTitle(t('nav.saved'));

  const result = useAsync((signal) => savedApi.list(signal), []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remove = async (productId: string) => {
    setBusyId(productId);
    setError(null);
    try {
      await savedApi.remove(productId);
      result.reload();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusyId(null);
    }
  };

  const addToCart = async (productId: string) => {
    setBusyId(productId);
    setError(null);
    try {
      await cartApi.add(productId, 1);
      bumpCartCount();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusyId(null);
    }
  };

  const items = (result.data?.items ?? []) as unknown as ProductSummary[];

  return (
    <RoleShell role="customer" title={t('nav.saved')}>
      <div className="space-y-5">
        {error && <Notice tone="danger">{error}</Notice>}

        {result.loading && <ProductGridSkeleton count={4} />}
        {!result.loading && result.error && (
          <ErrorState message={result.error} onRetry={result.reload} />
        )}

        {!result.loading && !result.error && items.length === 0 && (
          <EmptyState
            icon={<Bookmark className="size-6" aria-hidden="true" />}
            title={t('customer.savedEmpty')}
            description={t('customer.emptyCartHelp')}
            action={
              <Button onClick={() => navigate('/explore')}>{t('landing.browseCrops')}</Button>
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
                    size="sm"
                    loading={busyId === product.id}
                    onClick={() => void addToCart(product.id)}
                  >
                    <ShoppingCart className="size-4" aria-hidden="true" />
                    {t('customer.addToCart')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === product.id}
                    onClick={() => void remove(product.id)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    {t('common.remove')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </RoleShell>
  );
}
