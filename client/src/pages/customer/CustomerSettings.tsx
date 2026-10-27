import { useTranslation } from 'react-i18next';
import { RoleShell } from '@/components/layout/RoleShell';
import { AccountSettingsPanel } from '@/components/account/AccountSettingsPanel';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

/** Customer account settings. */
export default function CustomerSettings() {
  const { t } = useTranslation();
  useDocumentTitle(t('common.settings'));

  return (
    <RoleShell role="customer" title={t('common.settings')}>
      <AccountSettingsPanel role="customer" />
    </RoleShell>
  );
}
