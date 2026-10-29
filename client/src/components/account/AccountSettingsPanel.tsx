import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, Save, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { auth as authApi } from '@/lib/services';
import { fieldErrorsOf, messageOf } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, Notice } from '@/components/ui/Card';
import { TextInput } from '@/components/ui/Field';
import { LanguageSelector } from '@/components/layout/LanguageSelector';
import { useAsync } from '@/hooks/useCart';
import { formatDate } from '@/lib/format';

/**
 * Account settings, shared by farmers and customers.
 *
 * Two separate concerns are kept apart on purpose:
 *
 *  - Profile fields (name, phone) go through PATCH /api/auth/profile, which
 *    accepts only those columns. `role` is not among them and the database
 *    guard trigger would refuse it anyway, so a user cannot promote themselves
 *    by editing this form.
 *  - Language is written by the shared LanguageSelector, which also persists it
 *    to the account so the choice follows the user to another device.
 */
export function AccountSettingsPanel({ role }: { role: 'farmer' | 'customer' }) {
  const { t } = useTranslation();
  const { user, refresh } = useAuth();

  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordFailure, setPasswordFailure] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  const consents = useAsync((signal) => authApi.consents(signal), []);

  const saveProfile = async () => {
    setSaving(true);
    setErrors({});
    setSaved(false);
    setFailure(null);
    try {
      await authApi.updateProfile({ full_name: fullName, phone: phone || null });
      setSaved(true);
      await refresh();
    } catch (caught) {
      setErrors(fieldErrorsOf(caught));
      setFailure(messageOf(caught));
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    setChangingPassword(true);
    setPasswordErrors({});
    setPasswordSaved(false);
    setPasswordFailure(null);
    try {
      await authApi.changePassword({ current_password: currentPassword, new_password: newPassword });
      setPasswordSaved(true);
      setCurrentPassword('');
      setNewPassword('');
    } catch (caught) {
      setPasswordErrors(fieldErrorsOf(caught));
      setPasswordFailure(messageOf(caught));
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title={t('common.profile')} subtitle={t('auth.fullName')} />
        <CardBody className="space-y-4">
          {failure && <Notice tone="danger">{failure}</Notice>}
          {saved && <Notice tone="success">{t('common.save')}</Notice>}

          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              name="full_name"
              label={t('auth.fullName')}
              required
              value={fullName}
              error={errors['full_name']}
              onChange={(event) => setFullName(event.target.value)}
            />
            <TextInput
              name="phone"
              label={t('auth.phone')}
              value={phone}
              error={errors['phone']}
              onChange={(event) => setPhone(event.target.value)}
            />
            <TextInput
              name="email"
              label={t('auth.email')}
              value={user?.email ?? ''}
              disabled
              hint={t('account.emailHint')}
            />
            <TextInput name="role" label={t('account.role')} value={role} disabled />
          </div>

          <p className="flex items-start gap-1.5 text-xs text-soil-500">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {t('quality.distinctNote')}
          </p>

          <div className="flex justify-end">
            <Button loading={saving} onClick={() => void saveProfile()}>
              <Save className="size-4" aria-hidden="true" />
              {t('common.save')}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('common.language')} subtitle={t('nav.languageSettings')} />
        <CardBody>
          <LanguageSelector variant="settings" />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('auth.newPassword')} />
        <CardBody className="space-y-4">
          {passwordFailure && <Notice tone="danger">{passwordFailure}</Notice>}
          {passwordSaved && <Notice tone="success">{t('auth.accountCreated')}</Notice>}

          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              name="current_password"
              type="password"
              label={t('auth.password')}
              required
              value={currentPassword}
              error={passwordErrors['current_password']}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
            <TextInput
              name="new_password"
              type="password"
              label={t('auth.newPassword')}
              required
              hint={t('auth.passwordHint')}
              value={newPassword}
              error={passwordErrors['new_password']}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </div>

          <div className="flex justify-end">
            <Button
              variant="outline"
              loading={changingPassword}
              disabled={!currentPassword || !newPassword}
              onClick={() => void changePassword()}
            >
              <KeyRound className="size-4" aria-hidden="true" />
              {t('auth.resetPassword')}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('footer.privacy')} subtitle={t('account.consentsSubtitle')} />
        <CardBody>
          {(consents.data?.consents ?? []).length === 0 ? (
            <p className="text-sm text-soil-600">{t('account.noConsents')}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(consents.data?.consents ?? []).map((consent, index) => {
                const entry = consent as Record<string, unknown>;
                return (
                  <li key={index} className="flex justify-between gap-3 text-soil-700">
                    <span>{String(entry['consent_type'] ?? '')}</span>
                    <span className="text-soil-500">
                      {formatDate(String(entry['created_at'] ?? ''))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
