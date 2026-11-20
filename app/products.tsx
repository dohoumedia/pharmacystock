import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'expo-router';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from '../src/i18n/useTranslation';
import { Alert, Button, FormField, PageHeader, Surface, TextField } from '@/components/ui';
import { useOrganization } from '@/providers/OrganizationProvider';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { hasFreshMutationAuthorization } from '@/domain/mutationAuthorization';
import { STOCK_UNITS, stockUnitLabel, type StockUnit } from '@/domain/stockUnits';
import { errorPresentationKey } from '@/utils/errorPresentation';
import { loadBarcodes, loadCategories, loadManufacturers, type Barcode, type Category, type Manufacturer, type Product } from '@/services/catalog';
import { createCatalogProduct, maintainBarcode, searchProducts, setProductArchived, updateProduct } from '@/services/catalogReadiness';

type Fields = { name: string; genericName: string; brandName: string; strength: string; dosageForm: string; packageSize: string; sku: string; stockUnit: StockUnit; categoryId: string | null; manufacturerId: string | null };
const blank = (): Fields => ({ name: '', genericName: '', brandName: '', strength: '', dosageForm: '', packageSize: '', sku: '', stockUnit: 'unit', categoryId: null, manufacturerId: null });
export default function ProductsScreen() {
  const { organization } = useOrganization();
  return <ProductsContent key={organization?.id} />;
}
function ProductsContent() {
  const { t } = useTranslation();
  const { organization, can, usingCachedData, contextSyncedAt } = useOrganization();
  const { isOnline } = useConnectivity();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([]);
  const [search, setSearch] = useState(''); const [page, setPage] = useState(0); const [hasMore, setHasMore] = useState(false);
  const [showArchived, setShowArchived] = useState(false); const [fields, setFields] = useState<Fields>(blank);
  const [editing, setEditing] = useState<Product | null>(null); const [barcodes, setBarcodes] = useState<Barcode[]>([]); const [barcode, setBarcode] = useState('');
  const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null);
  const request = useRef(0); const barcodeRequest = useRef(0);
  const canRead = can('inventory.read'); const writable = hasFreshMutationAuthorization(isOnline, usingCachedData, contextSyncedAt);
  const canCreate = can('inventory.product.create') && writable; const canUpdate = can('inventory.product.update') && writable;
  const cancelEdit = () => { ++barcodeRequest.current; setEditing(null); setFields(blank()); setBarcodes([]); setBarcode(''); };
  const refresh = useCallback(async () => {
    const generation = ++request.current;
    if (!organization || !canRead || !isOnline) return;
    setLoading(true); setError(null);
    try {
      const [result, nextCategories, nextManufacturers] = await Promise.all([searchProducts(organization.id, search, page, showArchived ? null : 'active'), loadCategories(organization.id), loadManufacturers(organization.id)]);
      if (generation !== request.current) return;
      setProducts(result.items); setHasMore(result.hasMore); setCategories(nextCategories); setManufacturers(nextManufacturers);
    } catch (cause) { if (generation === request.current) setError(t(errorPresentationKey(cause))); }
    finally { if (generation === request.current) setLoading(false); }
  }, [organization, canRead, isOnline, search, page, showArchived, t]);
  useEffect(() => { const counter = request; const timer = setTimeout(() => void refresh(), 200); return () => { clearTimeout(timer); ++counter.current; }; }, [refresh]);
  const edit = async (product: Product) => {
    const generation = ++barcodeRequest.current; setError(null); setEditing(product); setBarcode(''); setBarcodes([]);
    setFields({ name: product.name, genericName: product.generic_name ?? '', brandName: product.brand_name ?? '', strength: product.strength ?? '', dosageForm: product.dosage_form ?? '', packageSize: product.package_size ?? '', sku: product.sku ?? '', stockUnit: (product.stock_unit ?? 'unit') as StockUnit, categoryId: product.category_id, manufacturerId: product.manufacturer_id });
    try { const rows = await loadBarcodes(product.id); if (generation === barcodeRequest.current) setBarcodes(rows); }
    catch (cause) { if (generation === barcodeRequest.current) setError(t(errorPresentationKey(cause))); }
  };
  const mutate = async (action: () => Promise<unknown>) => {
    if (!writable || saving) return; setSaving(true); setError(null); setMessage(null);
    try { await action(); setMessage(t('catalogReady.saved')); await refresh(); }
    catch (cause) { setError(t(errorPresentationKey(cause))); } finally { setSaving(false); }
  };
  const save = () => mutate(async () => {
    if (!organization) return;
    if (editing) await updateProduct(editing.id, { organizationId: organization.id, ...fields });
    else await createCatalogProduct({ organizationId: organization.id, ...fields, barcode });
    cancelEdit();
  });
  const changeBarcode = (action: 'ADD' | 'REMOVE' | 'PRIMARY', id?: string) => mutate(async () => {
    if (!organization || !editing) return; setBarcodes(await maintainBarcode(organization.id, editing.id, action, barcode, id)); setBarcode('');
  });
  const textFields = ['name', 'genericName', 'brandName', 'strength', 'dosageForm', 'packageSize', 'sku'] as const;
  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
    <PageHeader title={t('catalog.products')} subtitle={t('catalog.productsSubtitle')} />
    <View style={s.row}><Link href="/catalog-settings" asChild><Button variant="secondary" label={t('catalog.manageClassification')} /></Link><Link href="/batches" asChild><Button variant="secondary" label={t('catalog.manageBatches')} /></Link><Link href="/opening-stock" asChild><Button label={t('catalogReady.openingStock')} /></Link></View>
    {!isOnline || usingCachedData ? <Alert tone="warning" title={t('catalogReady.onlineOnly')} /> : null}
    {error ? <Alert tone="danger" title={error} /> : null}{message ? <Alert tone="success" title={message} /> : null}
    {canRead ? <><FormField label={t('catalogReady.search')}><TextField accessibilityLabel={t('catalogReady.search')} value={search} onChangeText={(value) => { setSearch(value); setPage(0); }} /></FormField>
      <Button variant="secondary" label={t(showArchived ? 'catalogReady.activeOnly' : 'catalogReady.includeArchived')} onPress={() => { setShowArchived((value) => !value); setPage(0); }} />
      {loading ? <Text>{t('common.loading')}</Text> : null}{!loading && !products.length ? <Text>{t('catalog.noProducts')}</Text> : null}
      {products.map((product) => <Surface key={product.id} style={s.card}><Text style={s.name}>{product.name}</Text><Text>{t('catalog.sku')}: {product.sku ?? '—'}</Text><Text>{t('catalogReady.stockUnit')}: {stockUnitLabel(product.stock_unit, t)}</Text><Text>{t('catalog.packageSize')}: {product.package_size ?? '—'}</Text>
        <Text>{t('catalog.category')}: {categories.find((item) => item.id === product.category_id)?.name ?? '—'}</Text><Text>{t('catalog.manufacturer')}: {manufacturers.find((item) => item.id === product.manufacturer_id)?.name ?? '—'}</Text>
        {product.status === 'archived' ? <Text>{t('catalogReady.archived')}</Text> : null}
        {canUpdate ? <View style={s.row}><Button label={t('catalogReady.edit')} onPress={() => void edit(product)} disabled={saving} /><Button variant="secondary" disabled={saving} label={t(product.status === 'archived' ? 'catalogReady.restore' : 'catalog.archive')} onPress={() => void mutate(() => setProductArchived(organization!.id, product.id, product.status !== 'archived'))} /></View> : null}
      </Surface>)}
      <View style={s.row}><Button variant="ghost" label={t('catalogReady.previous')} disabled={page === 0 || loading} onPress={() => setPage((value) => value - 1)} /><Text>{t('catalogReady.page', { page: page + 1 })}</Text><Button variant="ghost" label={t('catalogReady.next')} disabled={!hasMore || loading} onPress={() => setPage((value) => value + 1)} /></View>
    </> : <Alert tone="warning" title={t('production.inventoryView.cannotRead')} />}
    {(editing ? canUpdate : canCreate) ? <Surface style={s.card}>
      <Text style={s.name}>{t(editing ? 'catalogReady.edit' : 'catalog.addProduct')}{editing ? `: ${editing.name}` : ''}</Text>
      {textFields.map((key) => <FormField key={key} label={t(`catalog.${key}`)} required={key === 'name'} hint={key === 'packageSize' ? t('catalogReady.packageHint') : undefined}><TextField accessibilityLabel={t(`catalog.${key}`)} editable={!saving} value={fields[key]} onChangeText={(value) => setFields((current) => ({ ...current, [key]: value }))} /></FormField>)}
      <FormField label={t('catalogReady.stockUnit')} hint={t('catalogReady.unitHint')}><View style={s.row}>{STOCK_UNITS.map((unit) => <Button key={unit} label={`${fields.stockUnit === unit ? '✓ ' : ''}${stockUnitLabel(unit, t)}`} variant="secondary" disabled={saving} onPress={() => setFields((current) => ({ ...current, stockUnit: unit }))} />)}</View></FormField>
      <FormField label={t('catalog.category')}><View style={s.row}><Button variant="ghost" label={t('catalogReady.none')} onPress={() => setFields((current) => ({ ...current, categoryId: null }))} />{categories.map((item) => <Button key={item.id} label={`${fields.categoryId === item.id ? '✓ ' : ''}${item.name}`} variant="secondary" onPress={() => setFields((current) => ({ ...current, categoryId: item.id }))} />)}</View></FormField>
      <FormField label={t('catalog.manufacturer')}><View style={s.row}><Button variant="ghost" label={t('catalogReady.none')} onPress={() => setFields((current) => ({ ...current, manufacturerId: null }))} />{manufacturers.map((item) => <Button key={item.id} label={`${fields.manufacturerId === item.id ? '✓ ' : ''}${item.name}`} variant="secondary" onPress={() => setFields((current) => ({ ...current, manufacturerId: item.id }))} />)}</View></FormField>
      <FormField label={t('catalog.barcode')}><TextField accessibilityLabel={t('catalog.barcode')} editable={!saving} value={barcode} onChangeText={setBarcode} autoCapitalize="none" /></FormField>
      {editing ? <><Text>{t('catalogReady.barcodes')}</Text>{barcodes.length === 0 ? <Text>{t('catalogReady.noBarcodes')}</Text> : null}{barcodes.map((item) => <View key={item.id} style={s.row}><Text>{item.barcode}{item.is_primary ? ` · ${t('catalogReady.primary')}` : ''}</Text>{!item.is_primary ? <Button disabled={saving} variant="secondary" label={t('catalogReady.makePrimary')} onPress={() => void changeBarcode('PRIMARY', item.id)} /> : null}<Button disabled={saving} variant="ghost" label={t('catalogReady.remove')} onPress={() => void changeBarcode('REMOVE', item.id)} /></View>)}<Button disabled={saving || !barcode.trim() || !canCreate} variant="secondary" label={t('catalogReady.addBarcode')} onPress={() => void changeBarcode('ADD')} /></> : null}
      <View style={s.row}><Button label={t('common.save')} loading={saving} disabled={!fields.name.trim()} onPress={() => void save()} />{editing ? <Button label={t('common.cancel')} disabled={saving} variant="ghost" onPress={cancelEdit} /> : null}</View>
    </Surface> : null}
  </ScrollView></SafeAreaView>;
}
const s = StyleSheet.create({ safe: { flex: 1 }, container: { width: '100%', maxWidth: 1000, alignSelf: 'center', padding: 16, gap: 16 }, card: { padding: 16, gap: 12 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }, name: { fontSize: 18, fontWeight: '700' } });
