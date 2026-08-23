import { useState } from 'react';
import { Link } from 'expo-router';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useOrganization } from '@/providers/OrganizationProvider';
import { createBranch } from '@/services/organization';

export default function BranchesScreen() {
  const { t } = useTranslation();
  const { organization, branches, can, refresh } = useOrganization();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canManage = can('branch.manage');

  const submit = async () => {
    if (!organization || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createBranch({
        organization_id: organization.id,
        name: name.trim(),
        code: code.trim() || null,
        city: city.trim() || null,
        phone: phone.trim() || null,
        country_code: organization.country_code,
        timezone: organization.timezone,
      });
      setName('');
      setCode('');
      setCity('');
      setPhone('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.title}>{t('organization.branchesTitle')}</Text>
            <Text style={styles.subtitle}>{t('organization.branchesSubtitle')}</Text>
          </View>
          <Link href="/" asChild>
            <Pressable style={styles.secondaryButton} accessibilityRole="button">
              <Text style={styles.secondaryButtonText}>{t('organization.back')}</Text>
            </Pressable>
          </Link>
        </View>

        {branches.map((branch) => (
          <View key={branch.id} style={styles.card}>
            <Text style={styles.branchName}>{branch.name}</Text>
            <Text style={styles.meta}>{branch.code || t('common.noData')}</Text>
            <Text style={styles.meta}>{branch.city || ''}</Text>
            <Text style={styles.meta}>{branch.phone || ''}</Text>
          </View>
        ))}

        {canManage ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('organization.addBranch')}</Text>
            <TextInput value={name} onChangeText={setName} placeholder={t('organization.branchName')} style={styles.input} />
            <TextInput value={code} onChangeText={setCode} placeholder={t('organization.branchCode')} style={styles.input} autoCapitalize="characters" />
            <TextInput value={city} onChangeText={setCity} placeholder={t('organization.city')} style={styles.input} />
            <TextInput value={phone} onChangeText={setPhone} placeholder={t('organization.phone')} style={styles.input} keyboardType="phone-pad" />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable disabled={saving || !name.trim()} onPress={() => void submit()} style={[styles.primaryButton, (saving || !name.trim()) && styles.disabled]}>
              <Text style={styles.primaryButtonText}>{saving ? t('common.loading') : t('common.save')}</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8FC' },
  container: { padding: 24, gap: 16, width: '100%', maxWidth: 900, alignSelf: 'center' },
  headerRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  headerText: { flex: 1, minWidth: 260, gap: 4 },
  title: { fontSize: 28, fontWeight: '800', color: '#102A5C' },
  subtitle: { fontSize: 15, color: '#667085' },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#102A5C' },
  branchName: { fontSize: 18, fontWeight: '700', color: '#102A5C' },
  meta: { color: '#667085', fontSize: 13 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, gap: 12, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 1 },
  input: { borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: '#FFFFFF', color: '#101828' },
  error: { color: '#9F1239', fontSize: 14 },
  primaryButton: { alignSelf: 'flex-start', borderRadius: 10, backgroundColor: '#102A5C', paddingVertical: 12, paddingHorizontal: 18 },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '700' },
  secondaryButton: { borderWidth: 1, borderColor: '#98A2B3', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  secondaryButtonText: { color: '#344159', fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
