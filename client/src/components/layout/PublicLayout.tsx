import { Link, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useEffect } from 'react';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';

/**
 * The public site shell.
 *
 * Scrolls to the top on navigation. Without this, following a link from halfway
 * down a long catalogue leaves the next page scrolled to the middle, which
 * reads as a broken page.
 */
export function PublicLayout() {
  const { pathname } = useLocation();
  const { t } = useTranslation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-leaf-700 focus:px-4 focus:py-2 focus:text-white"
      >
        {t('common.skipToContent')}
      </a>
      <Header />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

/** A public page that is still being built out, so no route is ever blank. */
export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="container-page py-16">
      <div className="mx-auto max-w-2xl rounded-[var(--radius-card)] border border-soil-200 bg-white p-8 text-center shadow-[var(--shadow-card)]">
        <h1 className="text-2xl font-bold text-soil-900">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-soil-600">{description}</p>
        <Link
          to="/explore"
          className="mt-6 inline-block font-semibold text-leaf-700 underline underline-offset-4"
        >
          Browse the marketplace
        </Link>
      </div>
    </div>
  );
}
