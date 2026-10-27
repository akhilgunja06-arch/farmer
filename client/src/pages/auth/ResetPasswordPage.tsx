import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2 } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Field';
import { Notice } from '@/components/ui/Card';
import { auth as authApi } from '@/lib/services';
import { messageOf } from '@/lib/api';
import { resetPasswordSchema } from '@/lib/validation';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import type { z } from 'zod';

type Values = z.infer<typeof resetPasswordSchema>;

/**
 * The password reset form.
 *
 * The token comes from the emailed link's query string. Without one there is
 * nothing to submit against, so the page says so rather than showing a form
 * that would always fail.
 */
export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  useDocumentTitle(t('auth.resetPasswordTitle'));

  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(resetPasswordSchema) });

  const submit = async (values: Values) => {
    setError(null);
    try {
      await authApi.resetPassword({ token, new_password: values.password });
      setDone(true);
    } catch (caught) {
      setError(messageOf(caught));
    }
  };

  if (!token) {
    return (
      <AuthShell title={t('auth.resetPasswordTitle')}>
        <Notice tone="warning" title="This link is incomplete">
          The reset link is missing its token. Please open the link from your email again, or
          request a new one.
        </Notice>
        <Button className="mt-4" block onClick={() => navigate('/auth/forgot-password')}>
          {t('auth.resetPassword')}
        </Button>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title={t('auth.resetPasswordTitle')}>
        <div className="flex items-start gap-3 rounded-[var(--radius-control)] border border-leaf-200 bg-leaf-50 p-4">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-leaf-700" aria-hidden="true" />
          <p className="text-sm text-leaf-900">
            Your password has been changed. You can sign in with it now.
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => navigate('/farmer/login')}>{t('auth.farmerLoginTitle')}</Button>
          <Button variant="outline" onClick={() => navigate('/customer/login')}>
            {t('auth.customerLoginTitle')}
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t('auth.resetPasswordTitle')}>
      <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
        {error && <Notice tone="danger">{error}</Notice>}

        <TextInput
          label={t('auth.newPassword')}
          required
          type="password"
          autoComplete="new-password"
          hint={t('auth.passwordHint')}
          error={errors.password?.message}
          {...register('password')}
        />

        <TextInput
          label={t('auth.confirmPassword')}
          required
          type="password"
          autoComplete="new-password"
          error={errors.confirm_password?.message}
          {...register('confirm_password')}
        />

        <Button type="submit" block size="lg" loading={isSubmitting}>
          {t('auth.resetPassword')}
        </Button>

        <p className="text-center text-sm text-soil-600">
          <Link to="/auth/forgot-password" className="font-semibold text-leaf-700 hover:underline">
            {t('auth.forgotPassword')}
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
