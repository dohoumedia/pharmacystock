import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { colors, radii, spacing } from '@/theme/tokens';

type Props = {
  loading: boolean;
  usingCachedData: boolean;
  stale: boolean;
  syncedAt: string | null;
  hasData: boolean;
};

export function ReadModelStatus({ loading, usingCachedData, stale, syncedAt, hasData }: Props) {
  const { t, i18n } = useTranslation();
  const { isOnline } = useConnectivity();
  const kind = !isOnline ? 'offline' : loading ? 'syncing' : stale || usingCachedData ? 'stale' : 'synced';
  const formatted = syncedAt
    ? new Intl.DateTimeFormat(i18n.language, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(syncedAt))
    : t('production.readModel.never');

  return (
    <View accessibilityRole={kind === 'offline' || kind === 'stale' ? 'alert' : 'summary'} style={[styles.container, styles[kind]]}>
      <Text style={styles.title}>{t(`production.readModel.${kind}`)}</Text>
      <Text style={styles.detail}>
        {t(hasData ? 'production.readModel.lastSynced' : 'production.readModel.noCachedData', { date: formatted })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.xs,
    borderWidth: 1,
  },
  offline: { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' },
  stale: { backgroundColor: '#FFFAEB', borderColor: '#FEDF89' },
  syncing: { backgroundColor: '#EFF8FF', borderColor: '#B2DDFF' },
  synced: { backgroundColor: '#ECFDF3', borderColor: '#ABEFC6' },
  title: { color: colors.text, fontWeight: '800', fontSize: 14 },
  detail: { color: colors.muted, fontSize: 12 },
});
