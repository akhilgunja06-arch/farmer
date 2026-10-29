import {
  Bell,
  Bookmark,
  ClipboardList,
  FileCheck2,
  LayoutDashboard,
  MapPin,
  MessageSquare,
  Package,
  PlusCircle,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sprout,
  Store,
  TrendingUp,
  UserCog,
  Users,
  Wallet,
  Flag,
  ScrollText,
  Home,
} from 'lucide-react';
import type { SidebarLink } from './DashboardLayout';

/**
 * Sidebar definitions per role.
 *
 * Declared here rather than inside each dashboard page so the navigation is
 * described once. Each dashboard layout imports only its own list.
 */

export const farmerLinks: SidebarLink[] = [
  { to: '/farmer/dashboard', labelKey: 'farmer.overview', icon: LayoutDashboard, end: true },
  { to: '/farmer/products', labelKey: 'nav.myProducts', icon: Package },
  { to: '/farmer/products/new', labelKey: 'nav.addCrop', icon: PlusCircle },
  { to: '/farmer/orders', labelKey: 'nav.incomingOrders', icon: ClipboardList },
  { to: '/farmer/messages', labelKey: 'common.messages', icon: MessageSquare },
  { to: '/farmer/quality-reports', labelKey: 'nav.qualityReports', icon: FileCheck2 },
  { to: '/farmer/market-insights', labelKey: 'nav.marketInsights', icon: TrendingUp },
  { to: '/farmer/profile', labelKey: 'nav.farmProfile', icon: Sprout },
  { to: '/farmer/earnings', labelKey: 'nav.earnings', icon: Wallet },
  { to: '/notifications', labelKey: 'common.notifications', icon: Bell },
  { to: '/farmer/settings', labelKey: 'common.settings', icon: Settings },
];

export const customerLinks: SidebarLink[] = [
  { to: '/customer/dashboard', labelKey: 'customer.home', icon: Home, end: true },
  { to: '/explore', labelKey: 'nav.explore', icon: Store },
  { to: '/farmers', labelKey: 'nav.nearbyFarmers', icon: MapPin },
  { to: '/customer/cart', labelKey: 'nav.myCart', icon: ShoppingCart },
  { to: '/customer/orders', labelKey: 'nav.myOrders', icon: ClipboardList },
  { to: '/customer/saved', labelKey: 'nav.saved', icon: Bookmark },
  { to: '/customer/messages', labelKey: 'common.messages', icon: MessageSquare },
  { to: '/notifications', labelKey: 'common.notifications', icon: Bell },
  { to: '/customer/profile', labelKey: 'customer.profile', icon: UserCog },
  { to: '/customer/addresses', labelKey: 'nav.addresses', icon: MapPin },
  { to: '/customer/settings', labelKey: 'nav.languageSettings', icon: Settings },
];

export const adminLinks: SidebarLink[] = [
  { to: '/admin/dashboard', labelKey: 'admin.overview', icon: LayoutDashboard, end: true },
  { to: '/admin/users', labelKey: 'admin.users', icon: Users },
  { to: '/admin/farmers', labelKey: 'admin.farmers', icon: Sprout },
  { to: '/admin/products', labelKey: 'admin.products', icon: Package },
  { to: '/admin/orders', labelKey: 'admin.orders', icon: ClipboardList },
  { to: '/admin/quality-reviews', labelKey: 'admin.qualityReviews', icon: ShieldCheck },
  { to: '/admin/reports', labelKey: 'admin.reports', icon: Flag },
  { to: '/admin/settings', labelKey: 'admin.settings', icon: Settings },
  { to: '/admin/audit-logs', labelKey: 'admin.auditLogs', icon: ScrollText },
];
