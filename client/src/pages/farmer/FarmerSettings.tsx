import { useTranslation } from 'react-i18next';
import { RoleShell } from '@/components/layout/RoleShell';
import { AccountSettingsPanel } from '@/components/account/AccountSettingsPanel';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

/** Farmer account settings. */
export default function FarmerSettings() {
  const { t } = useTranslation();
  useDocumentTitle(t('common.settings'));

  return (
    <RoleShell role="farmer" title={t('common.settings')}>
      <AccountSettingsPanel role="farmer" />
    </RoleShell>
  );
}
