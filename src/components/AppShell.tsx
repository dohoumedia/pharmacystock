import { useState, type PropsWithChildren } from 'react';
import { Link, router, usePathname } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from '../i18n/useTranslation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/providers/AuthProvider';
import { useOrganization } from '@/providers/OrganizationProvider';
import { border, borderWidths, breakpoints, colors, disabledOpacity, focusRing, foreground, palette, shape, spacing, surface, touchTarget, typography } from '@/theme/tokens';
import { AppIcon } from './AppIcon';
import { primaryItems, secondaryItems, mobileItems as phoneItems, visibleNavigation, type NavItem } from '../navigation/items';
import { NotificationBadge } from './NotificationBadge';
import { SyncStatusBadge } from './SyncStatusBadge';
import { MetadataText, SupportingText } from './ui';

function ShellFrame({ children, style }: PropsWithChildren<{ style: StyleProp<ViewStyle> }>) {
  if (Platform.OS === 'web') return <View style={style}>{children}</View>;
  return <KeyboardAvoidingView style={style} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>{children}</KeyboardAvoidingView>;
}

function NavLink({ item, rail = false, bottom = false }: { item: NavItem; rail?: boolean; bottom?: boolean }) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const active = pathname === item.href;
  const [focused, setFocused] = useState(false);
  const label = t(item.labelKey);
  return (
    <Link href={item.href as '/'} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={label}
        accessibilityState={{ selected: active }}
        focusable
        onBlur={() => setFocused(false)}
        onFocus={() => setFocused(true)}
        style={StyleSheet.flatten([styles.navItem, rail && styles.railItem, bottom && styles.bottomNavItem, active && styles.navItemActive, focused && styles.navItemFocused])}
      >
        <AppIcon color={active ? foreground.inverse : bottom ? foreground.secondary : palette.neutral[200]} name={item.icon} size={bottom ? 16 : 18} />
        {!rail ? <Text numberOfLines={bottom ? 1 : undefined} style={[styles.navText, bottom && styles.bottomNavText, active && styles.navTextActive]}>{label}</Text> : null}
      </Pressable>
    </Link>
  );
}

function SessionControl({ compact = false, inTopbar = false }: { compact?: boolean; inTopbar?: boolean }) {
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await signOut();
      router.replace('/');
    } finally { setBusy(false); }
  };
  const label = t('auth.signOut');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={() => void submit()}
      style={StyleSheet.flatten([styles.sessionControl, compact && styles.sessionControlCompact, inTopbar && styles.sessionControlTopbar, focused && styles.sessionControlFocused, busy && styles.sessionControlDisabled])}
    >
      <AppIcon color={inTopbar ? foreground.brand : foreground.inverse} name="signOut" size={17} />
      {!compact ? <Text numberOfLines={1} style={[styles.sessionText, inTopbar && styles.sessionTextTopbar]}>{label}</Text> : null}
    </Pressable>
  );
}

export function AppShell({ children }: PropsWithChildren) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { organization, branch, can } = useOrganization();
  const desktop = width >= breakpoints.tablet;
  const rail = width < breakpoints.desktop;

  if (!user) return <ShellFrame style={styles.unsigned}>{children}</ShellFrame>;

  const primary = visibleNavigation(can, primaryItems);
  const secondary = visibleNavigation(can, secondaryItems);
  const mobileItems = visibleNavigation(can, phoneItems);
  const context = [organization?.name, branch?.name].filter(Boolean).join(' · ') || t('production.navigation.noContext');

  return (
    <ShellFrame style={styles.shell}>
      {desktop ? <View style={[styles.sidebar, rail && styles.rail]}>
        <View style={[styles.brandBlock, rail && styles.brandBlockRail]}>
          <View accessible={false} style={styles.brandMark}><Text style={styles.brandMarkText}>Rx</Text></View>
          {!rail ? <View style={styles.brandCopy}><Text numberOfLines={1} style={styles.brand}>{t('app.name')}</Text><MetadataText numberOfLines={1} style={styles.brandTagline}>{t('app.tagline')}</MetadataText></View> : null}
        </View>
        {!rail ? <View accessibilityLabel={context} style={styles.sidebarContext}><SupportingText numberOfLines={1} style={styles.sidebarContextOrganization}>{organization?.name ?? t('production.navigation.noContext')}</SupportingText><MetadataText numberOfLines={1} style={styles.sidebarContextBranch}>{branch?.name ?? t('production.navigation.noContext')}</MetadataText></View> : null}
        <ScrollView contentContainerStyle={styles.nav} showsVerticalScrollIndicator={false}>
          {primary.map((item) => <NavLink item={item} key={item.href} rail={rail} />)}
          {!rail ? <Text style={styles.navGroup}>{t('production.navigation.manage')}</Text> : <View style={styles.railDivider} />}
          {secondary.map((item) => <NavLink item={item} key={item.href} rail={rail} />)}
        </ScrollView>
        <View style={[styles.sidebarFooter, rail && styles.sidebarFooterRail]}><SyncStatusBadge compact={rail} /><SessionControl compact={rail} /></View>
      </View> : null}
      <View style={styles.main}>
        <View style={[styles.topbar, !desktop && styles.phoneTopbar, { paddingTop: insets.top }]}>
          <View accessibilityLabel={context} style={[styles.context, !desktop && styles.phoneContext]}><SupportingText numberOfLines={1} style={styles.contextOrganization}>{organization?.name ?? t('app.name')}</SupportingText><MetadataText numberOfLines={1} style={styles.contextBranch}>{branch?.name ?? t('production.navigation.noContext')}</MetadataText></View>
          <View style={[styles.topbarActions, !desktop && styles.phoneActions]}><NotificationBadge />{!desktop ? <SyncStatusBadge compact={width < breakpoints.narrow} /> : null}{!desktop ? <SessionControl inTopbar /> : null}</View>
        </View>
        <View style={[styles.content, !desktop && { paddingBottom: 76 + insets.bottom }]}>{children}</View>
        {!desktop ? <View style={[styles.bottomNav, { paddingBottom: insets.bottom }]}>{mobileItems.map((item) => <NavLink bottom item={item} key={item.href} />)}</View> : null}
      </View>
    </ShellFrame>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, flexDirection: 'row', backgroundColor: surface.canvas },
  unsigned: { flex: 1, backgroundColor: surface.canvas },
  sidebar: { width: 272, backgroundColor: colors.primary, borderRightWidth: borderWidths.hairline, borderRightColor: palette.navy[700], padding: spacing.lg, gap: spacing.md },
  rail: { width: 88, paddingHorizontal: spacing.sm },
  brandBlock: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  brandBlockRail: { justifyContent: 'center' },
  brandMark: { width: 38, height: 38, borderRadius: shape.md, backgroundColor: palette.navy[900], alignItems: 'center', justifyContent: 'center', borderWidth: borderWidths.hairline, borderColor: palette.teal[400] },
  brandMarkText: { color: palette.teal[400], fontSize: 17, fontWeight: '900' },
  brandCopy: { flexShrink: 1, gap: 1 }, brand: { color: foreground.inverse, ...typography.cardTitle }, brandTagline: { color: palette.neutral[200], ...typography.metadata, fontWeight: '400' },
  sidebarContext: { borderWidth: borderWidths.hairline, borderColor: palette.navy[700], backgroundColor: palette.navy[900], padding: spacing.md, borderRadius: shape.md, gap: 2 },
  sidebarContextOrganization: { color: foreground.inverse, ...typography.supporting, fontWeight: '800' }, sidebarContextBranch: { color: palette.neutral[200], ...typography.metadata, fontWeight: '400' },
  nav: { gap: spacing.xs, paddingBottom: spacing.lg }, navGroup: { color: palette.neutral[200], ...typography.metadata, marginTop: spacing.lg, marginBottom: spacing.sm, textTransform: 'uppercase' }, railDivider: { height: borderWidths.hairline, backgroundColor: palette.navy[700], marginVertical: spacing.sm },
  navItem: { minHeight: touchTarget, borderWidth: borderWidths.focus, borderColor: 'transparent', borderRadius: shape.md, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }, railItem: { justifyContent: 'center', paddingHorizontal: spacing.sm }, bottomNavItem: { flex: 1, minWidth: 0, flexDirection: 'column', justifyContent: 'center', gap: 2, paddingHorizontal: spacing.xs, borderRadius: shape.sm }, navItemActive: { backgroundColor: palette.navy[700], borderColor: palette.navy[600] }, navItemFocused: { borderColor: focusRing.color },
  navText: { color: palette.neutral[200], ...typography.body, fontWeight: '700', flexShrink: 1 }, bottomNavText: { ...typography.metadata, color: foreground.secondary, textAlign: 'center', width: '100%' }, navTextActive: { color: foreground.inverse },
  sidebarFooter: { marginTop: 'auto', gap: spacing.sm, alignItems: 'stretch' }, sidebarFooterRail: { alignItems: 'center' },
  sessionControl: { minHeight: touchTarget, borderRadius: shape.md, borderWidth: borderWidths.hairline, borderColor: palette.navy[700], flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md }, sessionControlCompact: { width: touchTarget, paddingHorizontal: 0 }, sessionControlTopbar: { backgroundColor: surface.default, borderColor: border.default }, sessionControlFocused: { borderColor: focusRing.color, borderWidth: focusRing.width }, sessionControlDisabled: { opacity: disabledOpacity }, sessionText: { color: foreground.inverse, ...typography.supporting, fontWeight: '700' }, sessionTextTopbar: { color: foreground.brand },
  phoneTopbar: { flexWrap: 'wrap', paddingHorizontal: spacing.lg, gap: spacing.sm },
  phoneContext: { flexBasis: '100%', flexGrow: 0, flexShrink: 0 },
  phoneActions: { width: '100%', flexShrink: 0, justifyContent: 'space-between' },
  main: { flex: 1, minWidth: 0 }, topbar: { minHeight: 68, backgroundColor: surface.default, borderBottomWidth: borderWidths.hairline, borderBottomColor: border.subtle, paddingHorizontal: spacing.xl, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }, context: { flex: 1, minWidth: 0, gap: 1 }, contextOrganization: { color: foreground.primary, ...typography.supporting, fontWeight: '800' }, contextBranch: { color: foreground.secondary, ...typography.metadata, fontWeight: '400' }, topbarActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.sm, flexShrink: 1 }, content: { flex: 1, minHeight: 0 }, bottomNav: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 76, backgroundColor: surface.default, borderTopWidth: borderWidths.hairline, borderTopColor: border.default, flexDirection: 'row', alignItems: 'stretch', justifyContent: 'space-around', paddingHorizontal: spacing.xs },
});
