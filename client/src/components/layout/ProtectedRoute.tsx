import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';
import { useAuth, homeForRole } from '@/contexts/AuthContext';
import { Spinner, ErrorState } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import type { Role } from '@/lib/types';

/**
 * Route protection.
 *
 * This is a usability layer, not a security boundary. Every request it guards
 * is also authorised on the server and again by row level security in the
 * database, so a user who edits the URL or the client state reaches a page that
 * then fails to load anything. Hiding a route is never the only defence.
 */

function FullPageSpinner() {
  return (
    <div className="grid min-h-screen place-items-center bg-rice-100">
      <Spinner />
    </div>
  );
}

export function ProtectedRoute({
  roles,
  children,
}: {
  roles: Role[];
  children?: ReactNode;
}) {
  const { user, loading, error, refresh } = useAuth();
  const location = useLocation();
  const { t } = useTranslation();

  if (loading) return <FullPageSpinner />;

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center bg-rice-100 p-4">
        <ErrorState message={error} onRetry={() => void refresh()} className="max-w-lg" />
      </div>
    );
  }

  if (!user) {
    // Remember where they were headed so sign-in can send them back.
    return <Navigate to="/auth/choose-role" state={{ from: location.pathname }} replace />;
  }

  if (!roles.includes(user.role)) {
    // Signed in, but this is not their area. Send them to their own home
    // rather than a dead end, and say why.
    return (
      <div className="grid min-h-screen place-items-center bg-rice-100 p-4">
        <div className="max-w-md rounded-[var(--radius-card)] border border-amber-200 bg-white p-8 text-center shadow-[var(--shadow-card)]">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-amber-50 text-amber-700">
            <ShieldAlert className="size-6" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-bold text-soil-900">This area is not for your account</h1>
          <p className="mt-2 text-sm leading-relaxed text-soil-600">
            You are signed in as {user.role}. {t('common.notFoundHelp')}
          </p>
          <Button className="mt-5" onClick={() => window.location.assign(homeForRole(user.role))}>
            Go to my dashboard
          </Button>
        </div>
      </div>
    );
  }

  return <>{children ?? <Outlet />}</>;
}
