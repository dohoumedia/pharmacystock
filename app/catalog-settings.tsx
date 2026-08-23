import { useCallback, useEffect, useState } from 'react';
import { Link } from 'expo-router';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useOrganization } from '@/providers/OrganizationProvider';
import {
  createCategory,
  createManufacturer,
  loadCategories,
  loadManufacturers,
  type Category,
  type Manufacturer,
} from '@/services/catalog';

export default function CatalogSettingsScreen() {
  const { t } = useTranslation();
  const { organization, can } = useOrganization();
  const [categories, setCategories] = useState<Category[]>([]);
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([]);
  const [categoryName, setCategoryName] = useState('');
  const [manufacturerName, setManufacturerName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canRead = can('inventory.read');
  const canCreate = can('inventory.product.create');

  const refresh = useCallback(async () => {
    if (!organization || !canRead) return;
    setError(null);
    try {
      const [nextCategories, nextManufacturers] = await Promise.all([
        loadCategories(organization.id),
        loadManufacturers(organization.id),
      ]);
      setCategories(nextCategories);
      setManufacturers(nextManufacturers);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR');
    }
  }, [organization, canRead]);

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const addCategory = async () => {
    if (!organization || !categoryName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createCategory(organization.id, categoryName);
      setCategoryName('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR');
    } finally {
      setSaving(false);
    }
  };

  const addManufacturer = async () => {
    if (!organization || !manufacturerName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createManufacturer(organization.id, manufacturerName);
      setManufacturerName('');
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
            <Text style={styles.title}>{t('catalog.classification')}</Text>
            <Text style={styles.subtitle}>{t('catalog.classificationSubtitle')}</Text>
          </View>
          <Link href="/products" asChild>
            <Pressable style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{t('catalog.manageProducts')}</Text></Pressable>
          </Link>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.columns}>
          <View style={[styles.card, styles.column]}>
            <Text style={styles.sectionTitle}>{t('catalog.categories')}</Text>
            {categories.map((item) => <Text key={item.id} style={styles.item}>{item.name}</Text>)}
            {canCreate ? (
              <View style={styles.inlineForm}>
                <TextInput value={categoryName} onChangeText={setCategoryName} placeholder={t('catalog.category')} style={[styles.input, styles.grow]} />
                <Pressable disabled={saving || !categoryName.trim()} onPress={() => void addCategory()} style={[styles.primaryButton, (saving || !categoryName.trim()) && styles.disabled]}>
                  <Text style={styles.primaryButtonText}>{t('common.save')}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          <View style={[styles.card, styles.column]}>
            <Text style={styles.sectionTitle}>{t('catalog.manufacturers')}</Text>
            {manufacturers.map((item) => <Text key={item.id} style={styles.item}>{item.name}</Text>)}
            {canCreate ? (
              <View style={styles.inlineForm}>
                <TextInput value={manufacturerName} onChangeText={setManufacturerName} placeholder={t('catalog.manufacturer')} style={[styles.input, styles.grow]} />
                <Pressable disabled={saving || !manufacturerName.trim()} onPress={() => void addManufacturer()} style={[styles.primaryButton, (saving || !manufacturerName.trim()) && styles.disabled]}>
                  <Text style={styles.primaryButtonText}>{t('common.save')}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8FC' },
  container: { padding: 24, gap: 16, width: '100%', maxWidth: 980, alignSelf: 'center' },
  headerRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  headerText: { flex: 1, minWidth: 260, gap: 4 },
  title: { fontSize: 28, fontWeight: '800', color: '#102A5C' },
  subtitle: { fontSize: 15, color: '#667085' },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  column: { flex: 1, minWidth: 300 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, gap: 10, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 1 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#102A5C' },
  item: { color: '#344159', paddingVertical: 4 },
  inlineForm: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  grow: { flex: 1, minWidth: 160 },
  input: { borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: '#FFFFFF', color: '#101828' },
  primaryButton: { borderRadius: 10, backgroundColor: '#102A5C', paddingVertical: 12, paddingHorizontal: 18 },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '700' },
  secondaryButton: { borderWidth: 1, borderColor: '#98A2B3', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  secondaryButtonText: { color: '#344159', fontWeight: '700' },
  error: { color: '#9F1239', fontSize: 14 },
  disabled: { opacity: 0.45 },
});
