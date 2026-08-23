import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { BatchSafetyStatus } from '@/domain/inventorySafety';
import { colors, radii, spacing } from '@/theme/tokens';

const tones: Record<BatchSafetyStatus, { backgroundColor: string; color: string }> = {
  ACTIVE: { backgroundColor: '#ECFDF3', color: colors.success },
  QUARANTINED: { backgroundColor: '#FFFAEB', color: colors.warning },
  RECALLED: { backgroundColor: '#FEF3F2', color: colors.danger },
  EXPIRED: { backgroundColor: '#FEF3F2', color: colors.danger },
  DEPLETED: { backgroundColor: '#F2F4F7', color: colors.muted },
  DISPOSED: { backgroundColor: '#F2F4F7', color: colors.muted },
  UNKNOWN: { backgroundColor: '#F2F4F7', color: colors.muted },
};

export function BatchStatusBadge({ status }: { status: BatchSafetyStatus }) {
  const { t } = useTranslation();
  const tone = tones[status];
  const label = t(`production.batchStatus.${status.toLowerCase()}`);
  return (
    <View accessibilityLabel={label} style={[styles.badge, { backgroundColor: tone.backgroundColor }]}>
      <Text style={[styles.text, { color: tone.color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  text: { fontSize: 12, fontWeight: '800' },
});
