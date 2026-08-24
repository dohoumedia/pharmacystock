import type { PropsWithChildren } from 'react';
import { Link, usePathname } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/providers/AuthProvider';
import { useOrganization } from '@/providers/OrganizationProvider';
import { breakpoints, colors, radii, spacing, touchTarget } from '@/theme/tokens';
import { SyncStatusBadge } from './SyncStatusBadge';

type NavItem = { href: string; labelKey: string; marker: string; permission?: string };

const primaryItems: NavItem[] = [
  { href: '/', labelKey: 'production.navigation.home', marker: 'H' },
  { href: '/pos', labelKey: 'production.navigation.pos', marker: 'P' },
  { href: '/inventory', labelKey: 'production.navigation.inventory', marker: 'I', permission: 'inventory.read' },
  { href: '/purchasing', labelKey: 'production.navigation.purchasing', marker: 'PO', permission: 'purchase.read' },
  { href: '/expiry', labelKey: 'production.navigation.expiry', marker: 'E', permission: 'inventory.read' },
  { href: '/transfers', labelKey: 'production.navigation.transfers', marker: 'T', permission: 'transfer.read' },
  { href: '/reports', labelKey: 'production.navigation.reports', marker: 'R', permission: 'reports.read' },
];

const secondaryItems: NavItem[] = [
  { href: '/customers', labelKey: 'production.navigation.customers', marker: 'C', permission: 'customer.read' },
  { href: '/products', labelKey: 'production.navigation.products', marker: 'PR', permission: 'inventory.read' },
  { href: '/batches', labelKey: 'production.navigation.batches', marker: 'B', permission: 'inventory.read' },
  { href: '/operations', labelKey: 'production.navigation.operations', marker: 'O' },
];

function NavLink({ item, rail = false, bottom = false }: { item: NavItem; rail?: boolean; bottom?: boolean }) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const active = pathname === item.href;
  return (
    <Link href={item.href as '/'} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityState={{ selected: active }}
        style={StyleSheet.flatten([
          styles.navItem,
          rail && styles.railItem,
          bottom && styles.bottomNavItem,
          active && styles.navItemActive,
        ])}
      >
        <Text style={[styles.marker, active && styles.navTextActive]}>{item.marker}</Text>
        {!rail ? <Text style={[styles.navText, active && styles.navTextActive]}>{t(item.labelKey)}</Text> : null}
      </Pressable>
    </Link>
  );
}

export function AppShell({ children }: PropsWithChildren) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { organization, branch, can } = useOrganization();
  const pathname = usePathname();
  const desktop = width >= breakpoints.tablet;
  const rail = width < breakpoints.desktop;

  if (!user) return <View style={styles.unsigned}>{children}</View>;

  const allowed = (item: NavItem) => !item.permission || can(item.permission);
  const primary = primaryItems.filter(allowed);
  const secondary = secondaryItems.filter(allowed);
  const mobileItems = [primaryItems[0], primaryItems[1], primaryItems[2], secondaryItems[3]].filter(
    (item): item is NavItem => Boolean(item && allowed(item)),
  );
  const current = [...primaryItems, ...secondaryItems].find((item) => item.href === pathname);

  return (
    <View style={styles.shell}>
      {desktop ? (
        <View style={[styles.sidebar, rail && styles.rail]}>
          <View style={[styles.brandBlock, rail && styles.brandBlockRail]}>
            <Text style={styles.brandMark}>Rx</Text>
            {!rail ? <Text style={styles.brand}>{t('app.name')}</Text> : null}
          </View>
          <ScrollView contentContainerStyle={styles.nav} showsVerticalScrollIndicator={false}>
            {primary.map((item) => <NavLink item={item} key={item.href} rail={rail} />)}
            {!rail ? <Text style={styles.navGroup}>{t('production.navigation.manage')}</Text> : null}
            {secondary.map((item) => <NavLink item={item} key={item.href} rail={rail} />)}
          </ScrollView>
          <View style={styles.sidebarStatus}><SyncStatusBadge compact={rail} /></View>
        </View>
      ) : null}
      <View style={styles.main}>
        <View style={[styles.topbar, { paddingTop: insets.top }]}>
          <View style={styles.context}>
            <Text numberOfLines={1} style={styles.screenTitle}>{current ? t(current.labelKey) : t('app.name')}</Text>
            <Text numberOfLines={1} style={styles.contextText}>
              {[organization?.name, branch?.name].filter(Boolean).join(' · ') || t('production.navigation.noContext')}
            </Text>
          </View>
          {!desktop ? <SyncStatusBadge compact={width < 420} /> : null}
        </View>
        <View style={[styles.content, !desktop && { paddingBottom: 68 + insets.bottom }]}>{children}</View>
        {!desktop ? (
          <View accessibilityRole="tablist" style={[styles.bottomNav, { paddingBottom: insets.bottom }]}>
            {mobileItems.map((item) => <NavLink bottom item={item} key={item.href} />)}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  unsigned: { flex: 1, backgroundColor: colors.background },
  sidebar: { width: 248, backgroundColor: colors.primary, padding: spacing.lg },
  rail: { width: 80, paddingHorizontal: spacing.sm },
  brandBlock: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  brandBlockRail: { justifyContent: 'center' },
  brandMark: { color: colors.accent, fontSize: 22, fontWeight: '900' },
  brand: { color: colors.surface, fontSize: 17, fontWeight: '800', flexShrink: 1 },
  nav: { gap: spacing.xs, paddingBottom: spacing.lg },
  navGroup: { color: '#AFC0DF', fontSize: 11, fontWeight: '800', marginTop: spacing.lg, marginBottom: spacing.sm, textTransform: 'uppercase' },
  navItem: { minHeight: touchTarget, borderRadius: radii.md, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  railItem: { justifyContent: 'center', paddingHorizontal: spacing.sm },
  bottomNavItem: { flex: 1, flexDirection: 'column', justifyContent: 'center', gap: 2, paddingHorizontal: spacing.xs },
  navItemActive: { backgroundColor: '#254477' },
  marker: { width: 24, color: '#C9D5E9', fontSize: 12, fontWeight: '900', textAlign: 'center' },
  navText: { color: '#E4EAF4', fontSize: 14, fontWeight: '700', flexShrink: 1 },
  navTextActive: { color: colors.surface },
  sidebarStatus: { marginTop: 'auto', alignItems: 'center' },
  main: { flex: 1, minWidth: 0 },
  topbar: { minHeight: 68, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: spacing.xl, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  context: { flex: 1, minWidth: 0 },
  screenTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  contextText: { color: colors.muted, fontSize: 12, marginTop: 2 },
  content: { flex: 1, minHeight: 0 },
  bottomNav: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 68, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', alignItems: 'stretch', justifyContent: 'space-around', paddingHorizontal: spacing.xs },
});
