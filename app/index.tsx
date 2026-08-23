import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/providers/AuthProvider';

export default function HomeScreen() {
  const { t, i18n } = useTranslation();
  const { loading, user } = useAuth();

  const switchLanguage = async () => {
    await i18n.changeLanguage(i18n.language === 'fr' ? 'en' : 'fr');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.brand}>{t('app.name')}</Text>
        <Text style={styles.tagline}>{t('app.tagline')}</Text>

        <View style={styles.card}>
          <Text style={styles.title}>{t('foundation.title')}</Text>
          <Text style={styles.body}>{t('foundation.subtitle')}</Text>
          <Text style={styles.meta}>{t('foundation.database')}</Text>
          <Text style={styles.meta}>{t('foundation.platforms')}</Text>
          <Text style={styles.meta}>{loading ? t('common.loading') : user ? user.email : 'Auth session: signed out'}</Text>
        </View>

        <Pressable accessibilityRole="button" onPress={switchLanguage} style={styles.button}>
          <Text style={styles.buttonText}>
            {i18n.language === 'fr' ? t('common.english') : t('common.french')}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8FC' },
  container: { flex: 1, padding: 24, justifyContent: 'center', gap: 20, maxWidth: 720, width: '100%', alignSelf: 'center' },
  brand: { fontSize: 28, fontWeight: '800', color: '#102A5C' },
  tagline: { fontSize: 16, color: '#46536A' },
  card: { borderRadius: 18, backgroundColor: '#FFFFFF', padding: 24, gap: 12, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 14, elevation: 2 },
  title: { fontSize: 22, fontWeight: '700', color: '#102A5C' },
  body: { fontSize: 15, lineHeight: 22, color: '#344159' },
  meta: { fontSize: 14, color: '#667085' },
  button: { alignSelf: 'flex-start', borderRadius: 10, backgroundColor: '#00B8E6', paddingVertical: 12, paddingHorizontal: 18 },
  buttonText: { color: '#FFFFFF', fontWeight: '700' },
});
