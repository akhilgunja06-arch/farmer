import { RoleShell } from '@/components/layout/RoleShell';
import { ConversationsPanel } from '@/components/marketplace/ConversationsPanel';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useTranslation } from 'react-i18next';

/** The customer's inbox, sharing the conversation view with the farmer area. */
export default function CustomerMessages() {
  const { t } = useTranslation();
  useDocumentTitle(t('messages.title'));

  return (
    <RoleShell role="customer" title={t('messages.title')}>
      <ConversationsPanel />
    </RoleShell>
  );
}
