import { useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Menu,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/Button';
import { LanguageSelector } from './LanguageSelector';
import { Logo } from './Logo';

export interface SidebarLink {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  end?: boolean;
  /** Optional count shown as a pill, e.g. unread messages. */
  badge?: number;
}

/**
 * The dashboard shell shared by farmer, customer and admin areas.
 *
 * One component for all three roles: the navigation differs but the structure,
 * the collapse behaviour and the mobile drawer do not. Duplicating this three
 * times would guarantee they drift apart.
 */
export function DashboardLayout({
  links,
  title,
  children,
  headerAction,
}: {
  links: SidebarLink[];
  title: string;
  children: ReactNode;
  headerAction?: ReactNode;
}) {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const nav = (
    <nav className="flex h-full flex-col" aria-label={title}>
      <div className="flex h-16 shrink-0 items-center justify-between px-4">
        {!collapsed && <Logo size="sm" to={null} />}
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="hidden rounded-lg p-2 text-soil-500 hover:bg-soil-100 hover:text-soil-800 lg:block"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <ChevronRight className="size-5" aria-hidden="true" />
          ) : (
            <ChevronLeft className="size-5" aria-hidden="true" />
          )}
        </button>
      </div>

      <ul className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {links.map((link) => (
          <li key={link.to}>
            <NavLink
              to={link.to}
              end={link.end}
              onClick={() => setMobileOpen(false)}
              title={collapsed ? t(link.labelKey) : undefined}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors',
                  collapsed && 'justify-center px-2',
                  isActive
                    ? 'bg-leaf-100 text-leaf-900'
                    : 'text-soil-700 hover:bg-soil-100 hover:text-soil-900',
                )
              }
            >
              <link.icon className="size-5 shrink-0" aria-hidden="true" />
              {!collapsed && <span className="flex-1 truncate">{t(link.labelKey)}</span>}
              {!collapsed && typeof link.badge === 'number' && link.badge > 0 && (
                <span className="tabular grid min-w-[1.25rem] place-items-center rounded-full bg-leaf-700 px-1 text-[0.65rem] font-bold text-white">
                  {link.badge > 99 ? '99+' : link.badge}
                </span>
              )}
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="shrink-0 border-t border-soil-200 p-3">
        {!collapsed && (
          <div className="mb-2 px-1">
            <p className="truncate text-sm font-semibold text-soil-900">{user?.full_name}</p>
            <p className="truncate text-xs text-soil-600">{user?.email}</p>
          </div>
        )}
        <Button
          variant="ghost"
          block={!collapsed}
          onClick={() => void handleSignOut()}
          className={cn(collapsed && 'px-0')}
        >
          <LogOut className="size-4 shrink-0" aria-hidden="true" />
          {!collapsed && <span>{t('common.logout')}</span>}
        </Button>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-rice-100">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 border-r border-soil-200 bg-white lg:block',
          collapsed ? 'w-[4.5rem]' : 'w-64',
        )}
      >
        {nav}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-soil-900/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-10 h-full w-72 border-r border-soil-200 bg-white">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 rounded-lg p-2 text-soil-600 hover:bg-soil-100"
              aria-label={t('common.closeMenu')}
            >
              <X className="size-5" aria-hidden="true" />
            </button>
            {nav}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-soil-200 bg-white/95 px-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-2 text-soil-700 hover:bg-soil-100 lg:hidden"
              aria-label={t('common.openMenu')}
            >
              <Menu className="size-5" aria-hidden="true" />
            </button>
            <h1 className="truncate text-lg font-bold text-soil-900">{title}</h1>
          </div>

          <div className="flex items-center gap-2">
            {headerAction}
            <Link
              to="/notifications"
              className="rounded-lg p-2 text-soil-600 hover:bg-soil-100"
              aria-label={t('common.notifications')}
            >
              <Bell className="size-5" aria-hidden="true" />
            </Link>
            <LanguageSelector className="hidden sm:inline-flex" />
            <Link
              to="/"
              className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-soil-700 hover:bg-soil-100 sm:inline-block"
            >
              {t('nav.home')}
            </Link>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
