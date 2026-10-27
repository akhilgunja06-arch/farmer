import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Field';
import { Notice } from '@/components/ui/Card';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError, messageOf } from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

/**
 * Administrator sign-in.
 *
 * A separate route and a separate expected role. The server refuses a
 * non-administrator here with a clear message, so a farmer who guesses this URL
 * learns nothing and gets nowhere — and even if they did reach the dashboard,
 * every admin endpoint is authorised again server-side and by row level
 * security.
 */
export default function AdminLogin() {
  const { t } = useTranslation();
  const { signIn, user, loading } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useDocumentTitle(t('auth.adminLoginTitle'));

  if (!loading && user?.role === 'admin') {
    return <Navigate to="/admin/dashboard" replace />;
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password, 'admin');
      navigate('/admin/dashboard', { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'ACCOUNT_SUSPENDED') {
        setError(t('auth.suspended'));
      } else {
        setError(messageOf(caught));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title={t('auth.adminLoginTitle')}
      subtitle={t('auth.adminLoginNote')}
      footer={
        <Link to="/" className="font-semibold text-leaf-700 hover:underline">
          {t('common.goHome')}
        </Link>
      }
    >
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        {error && <Notice tone="danger">{error}</Notice>}

        <TextInput
          name="email"
          type="email"
          label={t('auth.email')}
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <div className="relative">
          <TextInput
            name="password"
            type={showPassword ? 'text' : 'password'}
            label={t('auth.password')}
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            className="absolute right-3 top-9 text-soil-500 hover:text-soil-700"
            aria-label={showPassword ? t('common.close') : t('common.viewDetails')}
          >
            {showPassword ? (
              <EyeOff className="size-4" aria-hidden="true" />
            ) : (
              <Eye className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>

        <Button type="submit" block loading={submitting}>
          <ShieldCheck className="size-4" aria-hidden="true" />
          {t('auth.signIn')}
        </Button>

        <p className="text-center text-xs leading-relaxed text-soil-600">
          {t('auth.adminLoginNote')}
        </p>
      </form>
    </AuthShell>
  );
}
