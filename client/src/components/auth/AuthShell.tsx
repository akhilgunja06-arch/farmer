import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '@/components/layout/Logo';
import { LanguageSelector } from '@/components/layout/LanguageSelector';

/**
 * The frame around every authentication screen.
 *
 * Centred card, language selector available before sign-in (a user who cannot
 * read the current language must be able to change it before registering), and
 * a link back to the public site.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  wide,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-rice-100">
      <header className="border-b border-soil-200 bg-rice-50">
        <div className="container-page flex h-16 items-center justify-between">
          <Logo />
          <div className="flex items-center gap-3">
            <LanguageSelector />
            <Link
              to="/"
              className="hidden text-sm font-semibold text-soil-700 hover:text-leaf-800 hover:underline sm:block"
            >
              Back to site
            </Link>
          </div>
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center">
        <div className={wide ? 'w-full max-w-3xl' : 'w-full max-w-md'}>
          <div className="rounded-[var(--radius-card)] border border-soil-200 bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
            <h1 className="text-2xl font-bold text-soil-900">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm leading-relaxed text-soil-600">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
          {footer && <div className="mt-5 text-center text-sm text-soil-600">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
