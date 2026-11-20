import type { AppIconName } from '@/components/AppIcon';
export type NavItem = { href: string; labelKey: string; icon: AppIconName; permission?: string };
export const primaryItems: NavItem[] = [
  { href: '/', labelKey: 'production.navigation.home', icon: 'home' },
  { href: '/pos', labelKey: 'production.navigation.pos', icon: 'pos', permission: 'sale.create' },
  { href: '/inventory', labelKey: 'production.navigation.inventory', icon: 'inventory', permission: 'inventory.read' },
  { href: '/purchasing', labelKey: 'production.navigation.purchasing', icon: 'purchasing', permission: 'purchase.read' },
  { href: '/expiry', labelKey: 'production.navigation.expiry', icon: 'expiry', permission: 'inventory.read' },
  { href: '/transfers', labelKey: 'production.navigation.transfers', icon: 'transfers', permission: 'transfer.read' },
  { href: '/reports', labelKey: 'production.navigation.reports', icon: 'reports', permission: 'reports.read' },
];
export const secondaryItems: NavItem[] = [
  { href: '/notifications', labelKey: 'notificationsReady.title', icon: 'operations', permission: 'notification.read' },
  { href: '/sales', labelKey: 'pos.salesHistory', icon: 'pos', permission: 'sale.read' },
  { href: '/suppliers', labelKey: 'setup.nav.suppliers', icon: 'purchasing', permission: 'purchase.read' },
  { href: '/products', labelKey: 'production.navigation.products', icon: 'products', permission: 'inventory.read' },
  { href: '/staff', labelKey: 'setup.nav.staff', icon: 'customers', permission: 'staff.manage' },
  { href: '/branches', labelKey: 'setup.nav.branches', icon: 'transfers' },
  { href: '/customers', labelKey: 'production.navigation.customers', icon: 'customers', permission: 'customer.read' },
  { href: '/batches', labelKey: 'production.navigation.batches', icon: 'batches', permission: 'inventory.read' },
  { href: '/operations', labelKey: 'setup.nav.operations', icon: 'operations' },
];
export const mobileItems: NavItem[] = [
  primaryItems[0]!, primaryItems[1]!, primaryItems[2]!,
  { href: '/more', labelKey: 'setup.nav.more', icon: 'operations' },
];
export function visibleNavigation(can: (permission: string) => boolean, items = [...primaryItems, ...secondaryItems]) {
  return items.filter((item) => !item.permission || can(item.permission));
}
