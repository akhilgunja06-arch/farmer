import { RoleShell } from '@/components/layout/RoleShell';
import { ConversationsPanel } from '@/components/marketplace/ConversationsPanel';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useTranslation } from 'react-i18next';

/**
 * The farmer's inbox.
 *
 * The conversation view itself is shared with the customer area — the two roles
 * need the same list-and-thread layout, and only the route differs.
 */
export default function FarmerMessages() {
  const { t } = useTranslation();
  useDocumentTitle(t('messages.title'));

  return (
    <RoleShell role="farmer" title={t('messages.title')}>
      <ConversationsPanel />
    </RoleShell>
  );
}
