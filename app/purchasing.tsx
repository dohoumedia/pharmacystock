import { useEffect, useMemo, useState } from 'react';
import { Link } from 'expo-router';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useOrganization } from '@/providers/OrganizationProvider';
import { loadProducts, type ProductListItem } from '@/services/catalog';
import {
  createPurchaseOrder,
  createSupplier,
  loadPurchaseOrderLines,
  loadPurchaseOrders,
  loadReceipts,
  loadSuppliers,
  receivePurchaseOrder,
  type PurchaseOrderLineWithProduct,
  type PurchaseOrderWithSupplier,
  type PurchaseReceipt,
  type Supplier,
} from '@/services/purchasing';

type Tab = 'orders' | 'suppliers' | 'receipts';

type DraftLine = { productId: string; quantity: string; unitCost: string };
type ReceiptDraft = { quantity: string; unitCost: string; lotNumber: string; expiryDate: string };

export default function PurchasingScreen() {
  const { t } = useTranslation();
  const { organization, branch, branches, setBranchId, can } = useOrganization();
  const [tab, setTab] = useState<Tab>('orders');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<PurchaseOrderWithSupplier[]>([]);
  const [receipts, setReceipts] = useState<PurchaseReceipt[]>([]);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [orderLines, setOrderLines] = useState<PurchaseOrderLineWithProduct[]>([]);
  const [draftLines, setDraftLines] = useState<Record<string, DraftLine>>({});
  const [receiptDrafts, setReceiptDrafts] = useState<Record<string, ReceiptDraft>>({});
  const [supplierName, setSupplierName] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('');
  const [supplierEmail, setSupplierEmail] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [receiptNumber, setReceiptNumber] = useState('');
  const [supplierInvoice, setSupplierInvoice] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRead = can('purchase.read');
  const canCreate = can('purchase.create');
  const canReceive = can('purchase.receive');

  const productMap = useMemo(() => new Map(products.map((item) => [item.id, item.name])), [products]);

  const refresh = async () => {
    if (!organization || !branch || !canRead) return;
    setLoading(true);
    setError(null);
    try {
      const [nextSuppliers, nextOrders, nextReceipts, nextProducts] = await Promise.all([
        loadSuppliers(organization.id),
        loadPurchaseOrders(organization.id, branch.id),
        loadReceipts(organization.id, branch.id),
        loadProducts(organization.id),
      ]);
      setSuppliers(nextSuppliers);
      setOrders(nextOrders);
      setReceipts(nextReceipts);
      setProducts(nextProducts);
      setSelectedSupplierId((current) => current && nextSuppliers.some((item) => item.id === current) ? current : nextSuppliers[0]?.id ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [organization?.id, branch?.id, canRead]);

  const openOrder = async (orderId: string) => {
    if (!organization) return;
    setSelectedOrderId(orderId);
    setError(null);
    try {
      const lines = await loadPurchaseOrderLines(organization.id, orderId, productMap);
      setOrderLines(lines);
      const next: Record<string, ReceiptDraft> = {};
      for (const line of lines) {
        const remaining = Number(line.ordered_quantity) - Number(line.received_quantity);
        next[line.id] = { quantity: remaining > 0 ? String(remaining) : '', unitCost: line.unit_cost == null ? '' : String(line.unit_cost), lotNumber: '', expiryDate: '' };
      }
      setReceiptDrafts(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR');
    }
  };

  const addOrderProduct = (productId: string) => {
    setDraftLines((current) => current[productId] ? current : { ...current, [productId]: { productId, quantity: '1', unitCost: '' } });
  };

  const submitSupplier = async () => {
    if (!organization || !supplierName.trim()) return;
    setSaving(true); setError(null);
    try {
      await createSupplier({ organizationId: organization.id, name: supplierName, phone: supplierPhone, email: supplierEmail });
      setSupplierName(''); setSupplierPhone(''); setSupplierEmail('');
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR'); }
    finally { setSaving(false); }
  };

  const submitOrder = async () => {
    if (!organization || !branch || !selectedSupplierId || !poNumber.trim()) return;
    const lines = Object.values(draftLines).map((line) => ({ productId: line.productId, quantity: Number(line.quantity), unitCost: line.unitCost ? Number(line.unitCost) : null })).filter((line) => Number.isFinite(line.quantity) && line.quantity > 0);
    if (!lines.length) return;
    setSaving(true); setError(null);
    try {
      await createPurchaseOrder({ organizationId: organization.id, branchId: branch.id, supplierId: selectedSupplierId, poNumber, expectedAt, lines });
      setPoNumber(''); setExpectedAt(''); setDraftLines({});
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR'); }
    finally { setSaving(false); }
  };

  const submitReceipt = async () => {
    if (!selectedOrderId || !receiptNumber.trim()) return;
    const lines = orderLines.map((line) => {
      const draft = receiptDrafts[line.id];
      return { purchaseOrderLineId: line.id, quantity: Number(draft?.quantity ?? 0), unitCost: draft?.unitCost ? Number(draft.unitCost) : null, lotNumber: draft?.lotNumber ?? '', expiryDate: draft?.expiryDate ?? '' };
    }).filter((line) => Number.isFinite(line.quantity) && line.quantity > 0 && line.lotNumber.trim() && line.expiryDate.trim());
    if (!lines.length) return;
    setSaving(true); setError(null);
    try {
      await receivePurchaseOrder({ purchaseOrderId: selectedOrderId, receiptNumber, supplierInvoiceNumber: supplierInvoice, lines });
      setReceiptNumber(''); setSupplierInvoice(''); setSelectedOrderId(null); setOrderLines([]); setReceiptDrafts({});
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR'); }
    finally { setSaving(false); }
  };

  if (!canRead) {
    return <SafeAreaView style={styles.safeArea}><View style={styles.container}><Text style={styles.error}>{t('purchasing.cannotRead')}</Text><Link href="/">{t('organization.back')}</Link></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <View style={styles.grow}><Text style={styles.title}>{t('purchasing.title')}</Text><Text style={styles.subtitle}>{t('purchasing.subtitle')}</Text></View>
          <Link href="/" asChild><Pressable style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{t('organization.back')}</Text></Pressable></Link>
        </View>

        <Text style={styles.label}>{t('organization.branch')}</Text>
        <View style={styles.chips}>{branches.map((item) => <Pressable key={item.id} onPress={() => setBranchId(item.id)} style={[styles.chip, item.id === branch?.id && styles.chipSelected]}><Text style={[styles.chipText, item.id === branch?.id && styles.chipTextSelected]}>{item.name}</Text></Pressable>)}</View>

        <View style={styles.chips}>
          {(['orders','suppliers','receipts'] as Tab[]).map((item) => <Pressable key={item} onPress={() => setTab(item)} style={[styles.chip, tab === item && styles.chipSelected]}><Text style={[styles.chipText, tab === item && styles.chipTextSelected]}>{t(`purchasing.tabs.${item}`)}</Text></Pressable>)}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? <Text style={styles.meta}>{t('common.loading')}</Text> : null}

        {tab === 'suppliers' ? <>
          {canCreate ? <View style={styles.card}><Text style={styles.sectionTitle}>{t('purchasing.addSupplier')}</Text><TextInput style={styles.input} placeholder={t('purchasing.supplierName')} value={supplierName} onChangeText={setSupplierName}/><TextInput style={styles.input} placeholder={t('organization.phone')} value={supplierPhone} onChangeText={setSupplierPhone}/><TextInput style={styles.input} placeholder={t('auth.email')} value={supplierEmail} onChangeText={setSupplierEmail}/><Pressable disabled={saving || !supplierName.trim()} onPress={() => void submitSupplier()} style={[styles.primaryButton, saving && styles.disabled]}><Text style={styles.primaryButtonText}>{t('common.save')}</Text></Pressable></View> : null}
          <View style={styles.card}><Text style={styles.sectionTitle}>{t('purchasing.suppliers')}</Text>{suppliers.length === 0 ? <Text style={styles.meta}>{t('purchasing.noSuppliers')}</Text> : suppliers.map((item) => <View key={item.id} style={styles.row}><View><Text style={styles.name}>{item.name}</Text><Text style={styles.meta}>{item.phone ?? item.email ?? '—'}</Text></View><Text style={styles.status}>{item.status}</Text></View>)}</View>
        </> : null}

        {tab === 'orders' ? <>
          {canCreate ? <View style={styles.card}><Text style={styles.sectionTitle}>{t('purchasing.newOrder')}</Text><Text style={styles.label}>{t('purchasing.supplier')}</Text><View style={styles.chips}>{suppliers.map((item) => <Pressable key={item.id} onPress={() => setSelectedSupplierId(item.id)} style={[styles.chip, selectedSupplierId === item.id && styles.chipSelected]}><Text style={[styles.chipText, selectedSupplierId === item.id && styles.chipTextSelected]}>{item.name}</Text></Pressable>)}</View><TextInput style={styles.input} placeholder={t('purchasing.poNumber')} value={poNumber} onChangeText={setPoNumber}/><TextInput style={styles.input} placeholder={t('purchasing.expectedAt')} value={expectedAt} onChangeText={setExpectedAt}/><Text style={styles.label}>{t('purchasing.addProducts')}</Text><View style={styles.chips}>{products.slice(0,80).map((item) => <Pressable key={item.id} onPress={() => addOrderProduct(item.id)} style={styles.chip}><Text style={styles.chipText}>{item.name}</Text></Pressable>)}</View>{Object.values(draftLines).map((line) => <View key={line.productId} style={styles.lineEditor}><Text style={styles.growText}>{productMap.get(line.productId)}</Text><TextInput keyboardType="decimal-pad" style={styles.smallInput} placeholder={t('purchasing.quantity')} value={line.quantity} onChangeText={(value) => setDraftLines((current) => ({ ...current, [line.productId]: { ...current[line.productId], quantity: value } }))}/><TextInput keyboardType="decimal-pad" style={styles.smallInput} placeholder={t('purchasing.unitCost')} value={line.unitCost} onChangeText={(value) => setDraftLines((current) => ({ ...current, [line.productId]: { ...current[line.productId], unitCost: value } }))}/></View>)}<Pressable disabled={saving || !selectedSupplierId || !poNumber.trim()} onPress={() => void submitOrder()} style={[styles.primaryButton, saving && styles.disabled]}><Text style={styles.primaryButtonText}>{t('purchasing.createOrder')}</Text></Pressable></View> : null}
          <View style={styles.card}><Text style={styles.sectionTitle}>{t('purchasing.orders')}</Text>{orders.length === 0 ? <Text style={styles.meta}>{t('purchasing.noOrders')}</Text> : orders.map((item) => <Pressable key={item.id} onPress={() => void openOrder(item.id)} style={styles.row}><View style={styles.grow}><Text style={styles.name}>{item.po_number}</Text><Text style={styles.meta}>{item.supplier_name} · {item.expected_at ?? '—'}</Text></View><Text style={styles.status}>{t(`purchasing.status.${item.status}`)}</Text></Pressable>)}</View>
          {selectedOrderId && canReceive ? <View style={styles.card}><Text style={styles.sectionTitle}>{t('purchasing.receiveOrder')}</Text><TextInput style={styles.input} placeholder={t('purchasing.receiptNumber')} value={receiptNumber} onChangeText={setReceiptNumber}/><TextInput style={styles.input} placeholder={t('purchasing.supplierInvoice')} value={supplierInvoice} onChangeText={setSupplierInvoice}/>{orderLines.map((line) => { const draft = receiptDrafts[line.id] ?? { quantity:'', unitCost:'', lotNumber:'', expiryDate:'' }; const remaining = Number(line.ordered_quantity)-Number(line.received_quantity); return <View key={line.id} style={styles.receiveBlock}><Text style={styles.name}>{line.product_name}</Text><Text style={styles.meta}>{t('purchasing.remaining')}: {remaining}</Text><TextInput keyboardType="decimal-pad" style={styles.input} placeholder={t('purchasing.quantityReceived')} value={draft.quantity} onChangeText={(value) => setReceiptDrafts((current) => ({ ...current, [line.id]: { ...draft, quantity:value } }))}/><TextInput style={styles.input} placeholder={t('catalog.lotNumber')} value={draft.lotNumber} onChangeText={(value) => setReceiptDrafts((current) => ({ ...current, [line.id]: { ...draft, lotNumber:value } }))}/><TextInput style={styles.input} placeholder={t('catalog.expiryDate')} value={draft.expiryDate} onChangeText={(value) => setReceiptDrafts((current) => ({ ...current, [line.id]: { ...draft, expiryDate:value } }))}/><TextInput keyboardType="decimal-pad" style={styles.input} placeholder={t('purchasing.unitCost')} value={draft.unitCost} onChangeText={(value) => setReceiptDrafts((current) => ({ ...current, [line.id]: { ...draft, unitCost:value } }))}/></View>})}<Pressable disabled={saving || !receiptNumber.trim()} onPress={() => void submitReceipt()} style={[styles.primaryButton, saving && styles.disabled]}><Text style={styles.primaryButtonText}>{t('purchasing.confirmReceipt')}</Text></Pressable></View> : null}
        </> : null}

        {tab === 'receipts' ? <View style={styles.card}><Text style={styles.sectionTitle}>{t('purchasing.receiptHistory')}</Text>{receipts.length === 0 ? <Text style={styles.meta}>{t('purchasing.noReceipts')}</Text> : receipts.map((item) => <View key={item.id} style={styles.row}><View><Text style={styles.name}>{item.receipt_number}</Text><Text style={styles.meta}>{new Date(item.received_at).toLocaleString()} · {item.supplier_invoice_number ?? '—'}</Text></View></View>)}</View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea:{flex:1,backgroundColor:'#F6F8FC'}, container:{padding:24,gap:18,maxWidth:1100,width:'100%',alignSelf:'center'}, headerRow:{flexDirection:'row',gap:12,alignItems:'center'}, grow:{flex:1}, growText:{flex:1,color:'#101828',fontWeight:'600'}, title:{fontSize:28,fontWeight:'800',color:'#102A5C'}, subtitle:{color:'#667085',marginTop:4}, card:{backgroundColor:'#FFF',borderRadius:16,padding:18,gap:12}, sectionTitle:{fontSize:20,fontWeight:'700',color:'#102A5C'}, label:{fontSize:13,fontWeight:'700',color:'#475467'}, meta:{color:'#667085',fontSize:13}, error:{color:'#B42318'}, input:{borderWidth:1,borderColor:'#D0D5DD',borderRadius:10,padding:11,color:'#101828'}, smallInput:{width:120,borderWidth:1,borderColor:'#D0D5DD',borderRadius:10,padding:10}, chips:{flexDirection:'row',flexWrap:'wrap',gap:8}, chip:{borderWidth:1,borderColor:'#D0D5DD',borderRadius:999,paddingVertical:8,paddingHorizontal:12}, chipSelected:{backgroundColor:'#102A5C',borderColor:'#102A5C'}, chipText:{fontSize:13,fontWeight:'600',color:'#344054'}, chipTextSelected:{color:'#FFF'}, row:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:12,paddingVertical:10,borderBottomWidth:1,borderBottomColor:'#EAECF0'}, lineEditor:{flexDirection:'row',alignItems:'center',gap:8}, receiveBlock:{gap:8,paddingVertical:10,borderBottomWidth:1,borderBottomColor:'#EAECF0'}, name:{fontWeight:'700',color:'#101828'}, status:{fontWeight:'700',color:'#344054'}, primaryButton:{alignSelf:'flex-start',backgroundColor:'#102A5C',borderRadius:10,paddingVertical:11,paddingHorizontal:16}, primaryButtonText:{color:'#FFF',fontWeight:'700'}, secondaryButton:{borderWidth:1,borderColor:'#98A2B3',borderRadius:10,paddingVertical:10,paddingHorizontal:14}, secondaryButtonText:{color:'#344054',fontWeight:'700'}, disabled:{opacity:.45}
});
