import type { ReactNode } from 'react';
import { DashboardLayout } from './DashboardLayout';
import { farmerLinks, customerLinks, adminLinks } from './sidebars';
import { useAsync } from '@/hooks/useCart';
import { messages as messagesApi } from '@/lib/services';

/**
 * The dashboard frame for a role.
 *
 * Fetches the unread message count once and injects it into the sidebar badge,
 * so the number is correct on every dashboard page without each one having to
 * fetch it.
 */
export function RoleShell({
  role,
  title,
  children,
  headerAction,
}: {
  role: 'farmer' | 'customer' | 'admin';
  title: string;
  children: ReactNode;
  headerAction?: ReactNode;
}) {
  const unread = useAsync(
    (signal) =>
      role === 'admin'
        ? Promise.resolve({ count: 0 })
        : messagesApi.unreadCount(signal),
    [role],
  );

  const base = role === 'farmer' ? farmerLinks : role === 'customer' ? customerLinks : adminLinks;
  const messagesPath =
    role === 'farmer'
      ? '/farmer/messages'
      : role === 'customer'
        ? '/customer/messages'
        : null;

  const links = base.map((link) =>
    messagesPath && link.to === messagesPath && (unread.data?.count ?? 0) > 0
      ? { ...link, badge: unread.data?.count }
      : link,
  );

  return (
    <DashboardLayout
      links={links}
      title={title}
      {...(headerAction ? { headerAction } : {})}
    >
      {children}
    </DashboardLayout>
  );
}
