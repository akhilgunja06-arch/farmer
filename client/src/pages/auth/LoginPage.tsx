import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Field';
import { Notice } from '@/components/ui/Card';
import { useAuth, homeForRole } from '@/contexts/AuthContext';
import { ApiError, messageOf } from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import type { Role } from '@/lib/types';

/**
 * Sign-in for farmers and customers.
 *
 * `expectedRole` is sent to the server, which refuses a customer signing in
 * through the farmer door with a clear explanation rather than silently letting
 * them in and confusing them later.
 */
export default function LoginPage({ role }: { role: Extract<Role, 'farmer' | 'customer'> }) {
  const { t } = useTranslation();
  const { signIn, user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const title =
    role === 'farmer' ? t('auth.farmerLoginTitle') : t('auth.customerLoginTitle');
  useDocumentTitle(title);

  // Already signed in: go straight to the right dashboard.
  if (!loading && user) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from ?? homeForRole(user.role)} replace />;
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);

    try {
      const signedIn = await signIn(email.trim(), password, role);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? homeForRole(signedIn.role), { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.code === 'ACCOUNT_SUSPENDED') {
          setError(t('auth.suspended'));
        } else {
          // WRONG_ROLE and the rest already carry a clear, specific message
          // from the server. Showing it verbatim keeps the two in step.
          setError(caught.message);
        }
        setFieldErrors(caught.fieldErrors ?? {});
      } else {
        setError(messageOf(caught));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const otherRole = role === 'farmer' ? 'customer' : 'farmer';

  return (
    <AuthShell
      title={title}
      subtitle={t('auth.welcomeBack')}
      footer={
        <>
          {t('auth.noAccount')}{' '}
          <Link
            to={role === 'farmer' ? '/farmer/register' : '/customer/register'}
            className="font-semibold text-leaf-700 hover:underline"
          >
            {role === 'farmer' ? t('auth.registerAsFarmer') : t('auth.registerAsCustomer')}
          </Link>
          <span className="mx-2 text-soil-300">·</span>
          <Link
            to={otherRole === 'farmer' ? '/farmer/login' : '/customer/login'}
            className="font-semibold text-soil-700 hover:underline"
          >
            {otherRole === 'farmer' ? t('auth.farmerLoginTitle') : t('auth.customerLoginTitle')}
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Notice tone="danger">{error}</Notice>}

        <TextInput
          name="email"
          type="email"
          label={t('auth.email')}
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
        />

        <div className="relative">
          <TextInput
            name="password"
            type={showPassword ? 'text' : 'password'}
            label={t('auth.password')}
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={fieldErrors.password}
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            className="absolute right-2 top-8 rounded p-1.5 text-soil-500 hover:bg-soil-100"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? (
              <EyeOff className="size-4" aria-hidden="true" />
            ) : (
              <Eye className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>

        <div className="flex justify-end">
          <Link
            to="/auth/forgot-password"
            className="text-sm font-semibold text-leaf-700 hover:underline"
          >
            {t('auth.forgotPassword')}
          </Link>
        </div>

        <Button type="submit" block size="lg" loading={submitting}>
          {t('auth.signIn')}
        </Button>
      </form>
    </AuthShell>
  );
}
