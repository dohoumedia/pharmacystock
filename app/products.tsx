import { useCallback, useEffect, useState } from 'react';
import { Link } from 'expo-router';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useOrganization } from '@/providers/OrganizationProvider';
import {
  archiveProduct,
  createProduct,
  loadCategories,
  loadManufacturers,
  loadProducts,
  type Category,
  type Manufacturer,
  type ProductListItem,
} from '@/services/catalog';

export default function ProductsScreen() {
  const { t } = useTranslation();
  const { organization, can } = useOrganization();
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([]);
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [genericName, setGenericName] = useState('');
  const [brandName, setBrandName] = useState('');
  const [strength, setStrength] = useState('');
  const [dosageForm, setDosageForm] = useState('');
  const [packageSize, setPackageSize] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [manufacturerId, setManufacturerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRead = can('inventory.read');
  const canCreate = can('inventory.product.create');
  const canUpdate = can('inventory.product.update');

  const refresh = useCallback(async () => {
    if (!organization || !canRead) return;
    setLoading(true);
    setError(null);
    try {
      const [nextProducts, nextCategories, nextManufacturers] = await Promise.all([
        loadProducts(organization.id, search),
        loadCategories(organization.id),
        loadManufacturers(organization.id),
      ]);
      setProducts(nextProducts);
      setCategories(nextCategories);
      setManufacturers(nextManufacturers);
      setCategoryId((current) => current && nextCategories.some((item) => item.id === current) ? current : null);
      setManufacturerId((current) => current && nextManufacturers.some((item) => item.id === current) ? current : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR');
    } finally {
      setLoading(false);
    }
  }, [organization, canRead, search]);

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 250);
    return () => clearTimeout(timer);
  }, [refresh]);

  const submit = async () => {
    if (!organization || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createProduct({
        organizationId: organization.id,
        name: name.trim(),
        genericName,
        brandName,
        strength,
        dosageForm,
        packageSize,
        sku,
        barcode,
        categoryId,
        manufacturerId,
      });
      setName('');
      setGenericName('');
      setBrandName('');
      setStrength('');
      setDosageForm('');
      setPackageSize('');
      setSku('');
      setBarcode('');
      setCategoryId(null);
      setManufacturerId(null);
      await refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'UNKNOWN_ERROR';
      setError(message === 'BARCODE_ALREADY_EXISTS' ? t('catalog.barcodeExists') : message);
    } finally {
      setSaving(false);
    }
  };

  const archive = async (productId: string) => {
    setError(null);
    try {
      await archiveProduct(productId);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR');
    }
  };

  const categoryName = (id: string | null) => categories.find((item) => item.id === id)?.name;
  const manufacturerName = (id: string | null) => manufacturers.find((item) => item.id === id)?.name;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.title}>{t('catalog.products')}</Text>
            <Text style={styles.subtitle}>{t('catalog.productsSubtitle')}</Text>
          </View>
          <View style={styles.actions}>
            <Link href="/catalog-settings" asChild>
              <Pressable style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{t('catalog.manageClassification')}</Text></Pressable>
            </Link>
            <Link href="/batches" asChild>
              <Pressable style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{t('catalog.manageBatches')}</Text></Pressable>
            </Link>
            <Link href="/" asChild>
              <Pressable style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{t('organization.back')}</Text></Pressable>
            </Link>
          </View>
        </View>

        {canRead ? <TextInput autoCapitalize="none" onChangeText={setSearch} placeholder={t('catalog.search')} style={styles.input} value={search} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? <Text style={styles.meta}>{t('common.loading')}</Text> : null}
        {!loading && canRead && products.length === 0 ? <Text style={styles.meta}>{t('catalog.noProducts')}</Text> : null}

        {products.map((product) => (
          <View style={styles.card} key={product.id}>
            <View style={styles.productHeader}>
              <View style={styles.grow}>
                <Text style={styles.productName}>{product.name}</Text>
                <Text style={styles.meta}>{[product.generic_name, product.brand_name, product.strength].filter(Boolean).join(' · ')}</Text>
              </View>
              {canUpdate ? <Pressable onPress={() => void archive(product.id)} style={styles.dangerButton}><Text style={styles.dangerText}>{t('catalog.archive')}</Text></Pressable> : null}
            </View>
            <Text style={styles.meta}>{t('catalog.category')}: {categoryName(product.category_id) || '—'}</Text>
            <Text style={styles.meta}>{t('catalog.manufacturer')}: {manufacturerName(product.manufacturer_id) || '—'}</Text>
            <Text style={styles.meta}>{t('catalog.sku')}: {product.sku || '—'}</Text>
            <Text style={styles.meta}>{t('catalog.barcode')}: {product.primaryBarcode || '—'}</Text>
            <Text style={styles.meta}>{[product.dosage_form, product.package_size].filter(Boolean).join(' · ')}</Text>
          </View>
        ))}

        {canCreate ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('catalog.addProduct')}</Text>
            <TextInput value={name} onChangeText={setName} placeholder={t('catalog.name')} style={styles.input} />
            <TextInput value={genericName} onChangeText={setGenericName} placeholder={t('catalog.genericName')} style={styles.input} />
            <TextInput value={brandName} onChangeText={setBrandName} placeholder={t('catalog.brandName')} style={styles.input} />
            <View style={styles.row}>
              <TextInput value={strength} onChangeText={setStrength} placeholder={t('catalog.strength')} style={[styles.input, styles.grow]} />
              <TextInput value={dosageForm} onChangeText={setDosageForm} placeholder={t('catalog.dosageForm')} style={[styles.input, styles.grow]} />
            </View>
            <View style={styles.row}>
              <TextInput value={packageSize} onChangeText={setPackageSize} placeholder={t('catalog.packageSize')} style={[styles.input, styles.grow]} />
              <TextInput value={sku} onChangeText={setSku} placeholder={t('catalog.sku')} style={[styles.input, styles.grow]} />
            </View>
            <TextInput value={barcode} onChangeText={setBarcode} placeholder={t('catalog.barcode')} style={styles.input} keyboardType="numeric" />

            {categories.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>{t('catalog.category')}</Text>
                <View style={styles.chips}>
                  {categories.map((item) => (
                    <Pressable key={item.id} onPress={() => setCategoryId(item.id === categoryId ? null : item.id)} style={[styles.chip, item.id === categoryId && styles.chipSelected]}>
                      <Text style={[styles.chipText, item.id === categoryId && styles.chipTextSelected]}>{item.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}

            {manufacturers.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>{t('catalog.manufacturer')}</Text>
                <View style={styles.chips}>
                  {manufacturers.map((item) => (
                    <Pressable key={item.id} onPress={() => setManufacturerId(item.id === manufacturerId ? null : item.id)} style={[styles.chip, item.id === manufacturerId && styles.chipSelected]}>
                      <Text style={[styles.chipText, item.id === manufacturerId && styles.chipTextSelected]}>{item.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}

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
  container: { padding: 24, gap: 16, width: '100%', maxWidth: 980, alignSelf: 'center' },
  headerRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  headerText: { flex: 1, minWidth: 260, gap: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  title: { fontSize: 28, fontWeight: '800', color: '#102A5C' },
  subtitle: { fontSize: 15, color: '#667085' },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#102A5C' },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: '#46536A' },
  productName: { fontSize: 18, fontWeight: '700', color: '#102A5C' },
  meta: { color: '#667085', fontSize: 13 },
  error: { color: '#9F1239', fontSize: 14 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, gap: 10, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 1 },
  productHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  grow: { flex: 1, minWidth: 180 },
  input: { borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: '#FFFFFF', color: '#101828' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  chipSelected: { backgroundColor: '#102A5C', borderColor: '#102A5C' },
  chipText: { color: '#344159', fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#FFFFFF' },
  primaryButton: { alignSelf: 'flex-start', borderRadius: 10, backgroundColor: '#102A5C', paddingVertical: 12, paddingHorizontal: 18 },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '700' },
  secondaryButton: { borderWidth: 1, borderColor: '#98A2B3', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  secondaryButtonText: { color: '#344159', fontWeight: '700' },
  dangerButton: { borderWidth: 1, borderColor: '#FDA4AF', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
  dangerText: { color: '#9F1239', fontWeight: '700', fontSize: 12 },
  disabled: { opacity: 0.45 },
});
