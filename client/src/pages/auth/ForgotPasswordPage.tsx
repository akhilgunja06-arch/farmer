import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { MailCheck } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Field';
import { Notice } from '@/components/ui/Card';
import { auth as authApi } from '@/lib/services';
import { messageOf } from '@/lib/api';
import { forgotPasswordSchema } from '@/lib/validation';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import type { z } from 'zod';

type Values = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('auth.resetPassword'));

  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(forgotPasswordSchema) });

  const submit = async (values: Values) => {
    setError(null);
    try {
      await authApi.forgotPassword(values.email);
      // Always report success, whether or not the address exists. Saying
      // "no such account" would let anyone test which emails are registered.
      setSent(true);
    } catch (caught) {
      setError(messageOf(caught));
    }
  };

  if (sent) {
    return (
      <AuthShell title={t('auth.resetPassword')}>
        <div className="flex items-start gap-3 rounded-[var(--radius-control)] border border-leaf-200 bg-leaf-50 p-4">
          <MailCheck className="mt-0.5 size-5 shrink-0 text-leaf-700" aria-hidden="true" />
          <p className="text-sm text-leaf-900">{t('auth.resetLinkSent')}</p>
        </div>
        <p className="mt-4 text-sm text-soil-600">
          <Link to="/customer/login" className="font-semibold text-leaf-700 hover:underline">
            {t('auth.signIn')}
          </Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t('auth.resetPassword')}
      subtitle={t('auth.resetPasswordSub')}
      footer={
        <Link to="/customer/login" className="font-semibold text-leaf-700 hover:underline">
          {t('auth.signIn')}
        </Link>
      }
    >
      <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <TextInput
          label={t('auth.email')}
          required
          type="email"
          inputMode="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <Button type="submit" block size="lg" loading={isSubmitting}>
          {t('auth.sendResetLink')}
        </Button>
      </form>
    </AuthShell>
  );
}
