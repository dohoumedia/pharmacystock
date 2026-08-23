import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/providers/AuthProvider';
import { useOrganization } from '@/providers/OrganizationProvider';

export default function HomeScreen() {
  const { t, i18n } = useTranslation();
  const { loading: authLoading, user } = useAuth();
  const {
    organizations,
    organization,
    branches,
    branch,
    role,
    permissions,
    loading: organizationLoading,
    error,
    setOrganizationId,
    setBranchId,
    can,
  } = useOrganization();

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
          <Text style={styles.meta}>
            {authLoading ? t('common.loading') : user ? user.email : t('auth.signedOut')}
          </Text>
        </View>

        {user ? (
          <View style={styles.card}>
            <Text style={styles.title}>{t('organization.title')}</Text>
            {organizationLoading ? <Text style={styles.body}>{t('common.loading')}</Text> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {!organizationLoading && organizations.length === 0 ? (
              <Text style={styles.body}>{t('organization.noOrganization')}</Text>
            ) : null}

            {organizations.length > 1 ? (
              <View style={styles.chips}>
                {organizations.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => setOrganizationId(item.id)}
                    style={[styles.chip, item.id === organization?.id && styles.chipSelected]}
                  >
                    <Text style={[styles.chipText, item.id === organization?.id && styles.chipTextSelected]}>{item.name}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {organization ? (
              <>
                <Text style={styles.organizationName}>{organization.name}</Text>
                <Text style={styles.meta}>
                  {t('organization.role')}: {role ? (i18n.language === 'fr' ? role.name_fr : role.name_en) : t('organization.noRole')}
                </Text>
                <Text style={styles.sectionLabel}>{t('organization.branch')}</Text>
                <View style={styles.chips}>
                  {branches.map((item) => (
                    <Pressable
                      key={item.id}
                      onPress={() => setBranchId(item.id)}
                      style={[styles.chip, item.id === branch?.id && styles.chipSelected]}
                    >
                      <Text style={[styles.chipText, item.id === branch?.id && styles.chipTextSelected]}>{item.name}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.meta}>
                  {t('organization.permissions')}: {permissions.length}
                </Text>
                {can('staff.manage') ? (
                  <Link href="/staff" asChild>
                    <Pressable accessibilityRole="button" style={styles.primaryButton}>
                      <Text style={styles.primaryButtonText}>{t('organization.manageStaff')}</Text>
                    </Pressable>
                  </Link>
                ) : null}
              </>
            ) : null}
          </View>
        ) : null}

        <Pressable accessibilityRole="button" onPress={switchLanguage} style={styles.languageButton}>
          <Text style={styles.primaryButtonText}>
            {i18n.language === 'fr' ? t('common.english') : t('common.french')}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8FC' },
  container: { flex: 1, padding: 24, justifyContent: 'center', gap: 20, maxWidth: 760, width: '100%', alignSelf: 'center' },
  brand: { fontSize: 28, fontWeight: '800', color: '#102A5C' },
  tagline: { fontSize: 16, color: '#46536A' },
  card: { borderRadius: 18, backgroundColor: '#FFFFFF', padding: 24, gap: 12, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 14, elevation: 2 },
  title: { fontSize: 22, fontWeight: '700', color: '#102A5C' },
  organizationName: { fontSize: 18, fontWeight: '700', color: '#102A5C' },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: '#46536A' },
  body: { fontSize: 15, lineHeight: 22, color: '#344159' },
  meta: { fontSize: 14, color: '#667085' },
  error: { fontSize: 14, color: '#9F1239' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  chipSelected: { backgroundColor: '#102A5C', borderColor: '#102A5C' },
  chipText: { color: '#344159', fontWeight: '600', fontSize: 13 },
  chipTextSelected: { color: '#FFFFFF' },
  primaryButton: { alignSelf: 'flex-start', borderRadius: 10, backgroundColor: '#102A5C', paddingVertical: 12, paddingHorizontal: 18 },
  languageButton: { alignSelf: 'flex-start', borderRadius: 10, backgroundColor: '#00B8E6', paddingVertical: 12, paddingHorizontal: 18 },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '700' },
});
