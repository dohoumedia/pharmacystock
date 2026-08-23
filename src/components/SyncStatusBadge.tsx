import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { useSyncStatus } from '@/providers/SyncStatusProvider';
import { colors, radii, spacing, touchTarget } from '@/theme/tokens';

const tone = {
  checking: { backgroundColor: '#FFF7E6', color: colors.warning },
  offline: { backgroundColor: '#FEE4E2', color: colors.danger },
  syncing: { backgroundColor: '#E0F2FE', color: '#0369A1' },
  conflict: { backgroundColor: '#FEE4E2', color: colors.danger },
  pending: { backgroundColor: '#FFF7E6', color: colors.warning },
  synced: { backgroundColor: '#ECFDF3', color: colors.success },
} as const;

export function SyncStatusBadge({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { refresh: refreshConnectivity } = useConnectivity();
  const { kind, pendingCount, conflictCount } = useSyncStatus();
  const statusTone = tone[kind];
  const count = kind === 'conflict' ? conflictCount : pendingCount;
  const label = t(`production.sync.${kind}`, { count });

  return (
    <Pressable
      accessibilityHint={kind === 'offline' ? t('production.sync.retryHint') : undefined}
      accessibilityLabel={label}
      accessibilityRole={kind === 'offline' ? 'button' : 'text'}
      onPress={kind === 'offline' ? () => void refreshConnectivity() : undefined}
      style={[styles.badge, { backgroundColor: statusTone.backgroundColor }]}
    >
      <View style={[styles.dot, { backgroundColor: statusTone.color }]} />
      <Text numberOfLines={1} style={[styles.label, { color: statusTone.color }]}>
        {compact ? t(`production.sync.short.${kind}`, { count }) : label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    minHeight: touchTarget,
    maxWidth: 280,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: 13, fontWeight: '800', flexShrink: 1 },
});
