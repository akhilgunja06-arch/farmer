import { useTranslation } from 'react-i18next';
import { Bell, CheckCheck } from 'lucide-react';
import { useAsync } from '@/hooks/useCart';
import { notifications as notificationsApi } from '@/lib/services';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, EmptyState, ErrorState, Spinner } from '@/components/ui/Card';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { formatRelative } from '@/lib/format';
import { useState } from 'react';

/** In-app notifications, with the read state stored on the server. */
export default function NotificationsPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('notifications.title'));

  const [nonce, setNonce] = useState(0);
  const result = useAsync(
    (signal) => notificationsApi.list(signal),
    [nonce],
  );

  const [marking, setMarking] = useState(false);

  const markAll = async () => {
    setMarking(true);
    try {
      await notificationsApi.markAllRead();
      setNonce((value) => value + 1);
    } finally {
      setMarking(false);
    }
  };

  const markOne = async (id: string) => {
    await notificationsApi.markRead(id);
    setNonce((value) => value + 1);
  };

  const items = result.data?.items ?? [];
  const unread = items.filter((item) => !item.read_at).length;

  return (
    <div className="container-page py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-soil-900">{t('notifications.title')}</h1>
          {unread > 0 && (
            <p className="mt-1 text-sm text-soil-600">
              {t('notifications.unreadCount', { count: unread })}
            </p>
          )}
        </div>
        {unread > 0 && (
          <Button variant="outline" onClick={() => void markAll()} loading={marking}>
            <CheckCheck className="size-4" aria-hidden="true" />
            {t('notifications.markAllRead')}
          </Button>
        )}
      </header>

      {result.loading ? (
        <Spinner />
      ) : result.error ? (
        <ErrorState message={result.error} onRetry={result.reload} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Bell className="size-6" aria-hidden="true" />}
          title={t('notifications.emptyTitle')}
          description={t('notifications.emptyHelp')}
        />
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id}>
              <Card className={item.read_at ? '' : 'border-leaf-200 bg-leaf-50/40'}>
                <CardBody>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="font-semibold text-soil-900">{item.title}</h2>
                      {item.body && (
                        <p className="mt-1 text-sm leading-relaxed text-soil-600">{item.body}</p>
                      )}
                      <p className="mt-2 text-xs text-soil-500">
                        {formatRelative(item.created_at)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      {item.link && (
                        <a
                          href={item.link}
                          className="text-sm font-semibold text-leaf-700 hover:underline"
                        >
                          {t('common.viewDetails')}
                        </a>
                      )}
                      {!item.read_at && (
                        <button
                          type="button"
                          onClick={() => void markOne(item.id)}
                          className="text-xs font-semibold text-soil-500 hover:text-soil-800"
                        >
                          {t('notifications.markRead')}
                        </button>
                      )}
                    </div>
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
