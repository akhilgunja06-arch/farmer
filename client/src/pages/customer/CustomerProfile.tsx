import { useTranslation } from 'react-i18next';
import { RoleShell } from '@/components/layout/RoleShell';
import { AccountSettingsPanel } from '@/components/account/AccountSettingsPanel';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

/** Customer profile. Shares the settings panel with the settings route. */
export default function CustomerProfile() {
  const { t } = useTranslation();
  useDocumentTitle(t('customer.profile'));

  return (
    <RoleShell role="customer" title={t('customer.profile')}>
      <AccountSettingsPanel role="customer" />
    </RoleShell>
  );
}
