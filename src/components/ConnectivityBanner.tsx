import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { colors, spacing, touchTarget } from '@/theme/tokens';

export function ConnectivityBanner() {
  const { t } = useTranslation();
  const { state, refresh } = useConnectivity();
  if (state === 'online') return null;

  const checking = state === 'checking';
  return (
    <View accessibilityRole="alert" style={[styles.banner, checking ? styles.checking : styles.offline]}>
      <Text style={styles.text}>{checking ? t('production.connectivity.checking') : t('production.connectivity.offline')}</Text>
      {!checking ? (
        <Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.button}>
          <Text style={styles.buttonText}>{t('production.connectivity.retry')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { minHeight: touchTarget, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  checking: { backgroundColor: '#FFF7E6' },
  offline: { backgroundColor: '#FEE4E2' },
  text: { color: colors.text, fontWeight: '700', flexShrink: 1 },
  button: { minHeight: touchTarget, justifyContent: 'center', paddingHorizontal: spacing.md },
  buttonText: { color: colors.primary, fontWeight: '800' },
});
