import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  LogOut,
  Menu,
  ShoppingCart,
  User as UserIcon,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAuth, homeForRole } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/Button';
import { Logo } from './Logo';
import { LanguageSelector } from './LanguageSelector';
import { useCartCount } from '@/hooks/useCart';

const PUBLIC_LINKS = [
  { to: '/', key: 'nav.home', end: true },
  { to: '/explore', key: 'nav.explore' },
  { to: '/farmers', key: 'nav.nearbyFarmers' },
  { to: '/how-it-works', key: 'nav.howItWorks' },
  { to: '/quality-standards', key: 'nav.qualityStandards' },
] as const;

/**
 * The public site header.
 *
 * Renders three different right-hand sides depending on whether anyone is
 * signed in and in what role, so a signed-in customer never sees "Log in".
 */
export function Header() {
  const { t } = useTranslation();
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const cartCount = useCartCount();

  const handleSignOut = async () => {
    await signOut();
    setMobileOpen(false);
    navigate('/');
  };

  return (
    <header className="sticky top-0 z-40 border-b border-soil-200/80 bg-rice-50/95 backdrop-blur supports-[backdrop-filter]:bg-rice-50/80">
      <div className="container-page">
        <div className="flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Logo />
            <nav className="hidden items-center gap-1 lg:flex" aria-label={t('common.openMenu')}>
              {PUBLIC_LINKS.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={'end' in link ? link.end : false}
                  className={({ isActive }) =>
                    cn(
                      'rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                      isActive
                        ? 'bg-leaf-100 text-leaf-900'
                        : 'text-soil-700 hover:bg-soil-100 hover:text-soil-900',
                    )
                  }
                >
                  {t(link.key)}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <LanguageSelector className="hidden sm:inline-flex" />

            {!loading && user && (
              <>
                {user.role === 'customer' && (
                  <Link
                    to="/customer/cart"
                    className="relative rounded-lg p-2 text-soil-700 hover:bg-soil-100"
                    aria-label={t('nav.myCart')}
                  >
                    <ShoppingCart className="size-5" aria-hidden="true" />
                    {cartCount > 0 && (
                      <span className="tabular absolute -right-0.5 -top-0.5 grid min-w-[1.25rem] place-items-center rounded-full bg-leaf-700 px-1 text-[0.65rem] font-bold text-white">
                        {cartCount > 99 ? '99+' : cartCount}
                      </span>
                    )}
                  </Link>
                )}

                <Link
                  to={homeForRole(user.role)}
                  className="hidden items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-soil-700 hover:bg-soil-100 sm:inline-flex"
                >
                  <LayoutDashboard className="size-4" aria-hidden="true" />
                  {t('common.dashboard')}
                </Link>

                <Button variant="outline" size="sm" onClick={() => void handleSignOut()}>
                  <LogOut className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{t('common.logout')}</span>
                </Button>
              </>
            )}

            {!loading && !user && (
              <>
                <Button variant="ghost" size="sm" onClick={() => navigate('/auth/choose-role')}>
                  {t('nav.register')}
                </Button>
                <Button size="sm" onClick={() => navigate('/customer/login')}>
                  {t('nav.login')}
                </Button>
              </>
            )}

            <button
              type="button"
              onClick={() => setMobileOpen((open) => !open)}
              className="rounded-lg p-2 text-soil-700 hover:bg-soil-100 lg:hidden"
              aria-expanded={mobileOpen}
              aria-label={mobileOpen ? t('common.closeMenu') : t('common.openMenu')}
            >
              {mobileOpen ? (
                <X className="size-5" aria-hidden="true" />
              ) : (
                <Menu className="size-5" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <nav className="border-t border-soil-200 py-3 lg:hidden" aria-label={t('nav.home')}>
            <ul className="space-y-1">
              {PUBLIC_LINKS.map((link) => (
                <li key={link.to}>
                  <NavLink
                    to={link.to}
                    end={'end' in link ? link.end : false}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        'block rounded-lg px-3 py-2.5 text-sm font-semibold',
                        isActive ? 'bg-leaf-100 text-leaf-900' : 'text-soil-700 hover:bg-soil-100',
                      )
                    }
                  >
                    {t(link.key)}
                  </NavLink>
                </li>
              ))}
              {user && (
                <li>
                  <Link
                    to={homeForRole(user.role)}
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-soil-700 hover:bg-soil-100"
                  >
                    <UserIcon className="size-4" aria-hidden="true" />
                    {t('common.dashboard')}
                  </Link>
                </li>
              )}
            </ul>
            <div className="mt-3 border-t border-soil-200 pt-3 sm:hidden">
              <LanguageSelector />
            </div>
          </nav>
        )}
      </div>
    </header>
  );
}
