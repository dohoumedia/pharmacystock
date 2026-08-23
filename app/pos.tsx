import { useEffect, useMemo, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useOrganization } from '@/providers/OrganizationProvider';
import { completeSale, loadSaleItems, loadSales, quoteSale, refundSale, searchPosProducts, type CartLine, type PosProduct, type Sale, type SaleItem } from '@/services/sales';

type CartRow = CartLine & { product: PosProduct };

const paymentMethods = ['CASH','CARD','MOBILE_MONEY','BANK_TRANSFER','OTHER'] as const;

export default function PosScreen() {
  const { t } = useTranslation();
  const { organization, branch, can } = useOrganization();
  const [query,setQuery]=useState('');
  const [products,setProducts]=useState<PosProduct[]>([]);
  const [cart,setCart]=useState<CartRow[]>([]);
  const [quoteTotal,setQuoteTotal]=useState(0);
  const [paymentMethod,setPaymentMethod]=useState<(typeof paymentMethods)[number]>('CASH');
  const [sales,setSales]=useState<Sale[]>([]);
  const [selectedSale,setSelectedSale]=useState<Sale|null>(null);
  const [saleItems,setSaleItems]=useState<SaleItem[]>([]);
  const [refundReason,setRefundReason]=useState('');
  const [refundQuantity,setRefundQuantity]=useState('1');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);

  const canCreate=can('sale.create'); const canRead=can('sale.read'); const canRefund=can('sale.refund');
  const lines=useMemo(()=>cart.map(({product_id,quantity})=>({product_id,quantity})),[cart]);

  const refreshSales=async()=>{ if(!organization||!branch||!canRead)return; setSales(await loadSales(organization.id,branch.id)); };
  useEffect(()=>{ void refreshSales(); },[organization?.id,branch?.id,canRead]);
  useEffect(()=>{ if(!organization||!canCreate){setProducts([]);return;} const timer=setTimeout(()=>{void searchPosProducts(organization.id,query).then(setProducts).catch((e)=>setError(e.message));},200); return()=>clearTimeout(timer); },[organization?.id,query,canCreate]);
  useEffect(()=>{ if(!organization||!branch||!lines.length){setQuoteTotal(0);return;} void quoteSale(organization.id,branch.id,lines).then((q)=>{setQuoteTotal(Number(q.total_amount));setError(null);}).catch((e)=>{setQuoteTotal(0);setError(e.message);}); },[organization?.id,branch?.id,lines]);

  const addProduct=(product:PosProduct)=>setCart((current)=>{const existing=current.find((row)=>row.product_id===product.id); return existing?current.map((row)=>row.product_id===product.id?{...row,quantity:row.quantity+1}:row):[...current,{product_id:product.id,quantity:1,product}];});
  const setQuantity=(productId:string,value:string)=>{const q=Number(value); if(!Number.isFinite(q)||q<=0)return; setCart((current)=>current.map((row)=>row.product_id===productId?{...row,quantity:q}:row));};
  const removeProduct=(productId:string)=>setCart((current)=>current.filter((row)=>row.product_id!==productId));

  const submitSale=async()=>{
    if(!organization||!branch||!lines.length||quoteTotal<=0)return;
    setBusy(true);setError(null);setMessage(null);
    try{
      const stamp=Date.now();
      const saleId=await completeSale({organizationId:organization.id,branchId:branch.id,saleNumber:`SALE-${stamp}`,lines,payments:[{method:paymentMethod,amount:quoteTotal}],idempotencyKey:`sale:${branch.id}:${stamp}`});
      setCart([]);setQuoteTotal(0);setMessage(`${t('pos.saleComplete')} · ${saleId.slice(0,8)}`); await refreshSales();
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };

  const openSale=async(sale:Sale)=>{ if(!organization)return; setSelectedSale(sale); setSaleItems(await loadSaleItems(organization.id,sale.id)); };
  const submitRefund=async()=>{
    if(!selectedSale||!saleItems.length||!refundReason.trim())return;
    const qty=Number(refundQuantity); if(!Number.isFinite(qty)||qty<=0)return;
    setBusy(true);setError(null);
    try{const stamp=Date.now(); await refundSale({saleId:selectedSale.id,refundNumber:`REF-${stamp}`,items:[{sale_item_id:saleItems[0].id,quantity:qty}],idempotencyKey:`refund:${selectedSale.id}:${stamp}`,reason:refundReason}); setMessage(t('pos.refund')); setSelectedSale(null); setSaleItems([]); setRefundReason(''); await refreshSales();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };

  if(!organization||!branch)return <SafeAreaView style={styles.safe}><View style={styles.center}><Text>{t('organization.noOrganization')}</Text></View></SafeAreaView>;
  if(!canRead&&!canCreate)return <SafeAreaView style={styles.safe}><View style={styles.center}><Text>{t('pos.cannotRead')}</Text><Link href="/">{t('organization.back')}</Link></View></SafeAreaView>;

  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.container}>
    <View style={styles.header}><View><Text style={styles.title}>{t('pos.title')}</Text><Text style={styles.subtitle}>{t('pos.subtitle')}</Text></View><Link href="/" style={styles.link}>{t('organization.back')}</Link></View>
    {error?<Text style={styles.error}>{error}</Text>:null}{message?<Text style={styles.success}>{message}</Text>:null}

    {canCreate?<><View style={styles.card}><TextInput value={query} onChangeText={setQuery} placeholder={t('pos.search')} style={styles.input}/><View style={styles.list}>{products.map((p)=><View key={p.id} style={styles.row}><View style={styles.flex}><Text style={styles.bold}>{p.name}</Text><Text style={styles.meta}>{p.generic_name||p.brand_name||p.sku||''}</Text></View><Pressable style={styles.button} onPress={()=>addProduct(p)}><Text style={styles.buttonText}>{t('pos.add')}</Text></Pressable></View>)}</View></View>

    <View style={styles.card}><Text style={styles.section}>{t('pos.cart')}</Text>{cart.length===0?<Text style={styles.meta}>{t('pos.emptyCart')}</Text>:cart.map((row)=><View key={row.product_id} style={styles.row}><View style={styles.flex}><Text style={styles.bold}>{row.product.name}</Text><Text style={styles.meta}>{t('pos.quantity')}</Text></View><TextInput keyboardType="decimal-pad" value={String(row.quantity)} onChangeText={(v)=>setQuantity(row.product_id,v)} style={styles.qty}/><Pressable onPress={()=>removeProduct(row.product_id)}><Text style={styles.remove}>×</Text></Pressable></View>)}<Text style={styles.total}>{t('pos.estimatedTotal')}: {quoteTotal.toLocaleString()} XOF</Text><Text style={styles.note}>{t('pos.serverPriceNote')}</Text></View>

    <View style={styles.card}><Text style={styles.section}>{t('pos.payment')}</Text><View style={styles.chips}>{paymentMethods.map((m)=><Pressable key={m} onPress={()=>setPaymentMethod(m)} style={[styles.chip,paymentMethod===m&&styles.chipActive]}><Text style={paymentMethod===m?styles.chipTextActive:styles.chipText}>{m==='CASH'?t('pos.cash'):m==='CARD'?t('pos.card'):m==='MOBILE_MONEY'?t('pos.mobileMoney'):m==='BANK_TRANSFER'?t('pos.bankTransfer'):t('pos.other')}</Text></Pressable>)}</View><Pressable disabled={busy||!cart.length||quoteTotal<=0} onPress={()=>void submitSale()} style={[styles.primary,busy&&styles.disabled]}><Text style={styles.buttonText}>{busy?t('common.loading'):t('pos.completeSale')}</Text></Pressable></View></>:null}

    {canRead?<View style={styles.card}><Text style={styles.section}>{t('pos.salesHistory')}</Text>{sales.length===0?<Text style={styles.meta}>{t('pos.noSales')}</Text>:sales.map((sale)=><Pressable key={sale.id} style={styles.saleRow} onPress={()=>void openSale(sale)}><View><Text style={styles.bold}>{sale.sale_number}</Text><Text style={styles.meta}>{new Date(sale.completed_at).toLocaleString()} · {sale.status}</Text></View><Text style={styles.bold}>{Number(sale.total_amount).toLocaleString()} {sale.currency_code}</Text></Pressable>)}</View>:null}

    {selectedSale?<View style={styles.card}><Text style={styles.section}>{t('pos.receipt')} · {selectedSale.sale_number}</Text>{saleItems.map((item)=><Text key={item.id} style={styles.meta}>{item.quantity} × {Number(item.unit_price).toLocaleString()} = {Number(item.line_total).toLocaleString()} XOF</Text>)}<Text style={styles.total}>{Number(selectedSale.total_amount).toLocaleString()} {selectedSale.currency_code}</Text>{canRefund&&selectedSale.status!=='REFUNDED'?<><TextInput value={refundReason} onChangeText={setRefundReason} placeholder={t('pos.refundReason')} style={styles.input}/><TextInput value={refundQuantity} onChangeText={setRefundQuantity} keyboardType="decimal-pad" placeholder={t('pos.refundQuantity')} style={styles.input}/><Pressable disabled={busy||!refundReason.trim()} onPress={()=>void submitRefund()} style={styles.secondary}><Text>{t('pos.confirmRefund')}</Text></Pressable></>:null}</View>:null}
  </ScrollView></SafeAreaView>;
}

const styles=StyleSheet.create({safe:{flex:1,backgroundColor:'#F6F8FC'},container:{padding:24,gap:16,maxWidth:1000,width:'100%',alignSelf:'center'},center:{flex:1,alignItems:'center',justifyContent:'center',gap:12},header:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',gap:12},title:{fontSize:28,fontWeight:'800',color:'#102A5C'},subtitle:{fontSize:15,color:'#667085',marginTop:4},link:{color:'#102A5C',fontWeight:'700'},card:{backgroundColor:'#fff',padding:18,borderRadius:16,gap:12},section:{fontSize:19,fontWeight:'700',color:'#102A5C'},input:{borderWidth:1,borderColor:'#D0D5DD',borderRadius:10,padding:12},list:{gap:8},row:{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:8,borderBottomWidth:1,borderBottomColor:'#EAECF0'},saleRow:{flexDirection:'row',justifyContent:'space-between',gap:12,paddingVertical:12,borderBottomWidth:1,borderBottomColor:'#EAECF0'},flex:{flex:1},bold:{fontWeight:'700',color:'#101828'},meta:{color:'#667085'},button:{backgroundColor:'#102A5C',paddingVertical:8,paddingHorizontal:12,borderRadius:8},primary:{backgroundColor:'#102A5C',padding:14,borderRadius:10,alignItems:'center'},secondary:{borderWidth:1,borderColor:'#98A2B3',padding:12,borderRadius:10,alignItems:'center'},buttonText:{color:'#fff',fontWeight:'700'},qty:{width:72,borderWidth:1,borderColor:'#D0D5DD',borderRadius:8,padding:8,textAlign:'center'},remove:{fontSize:26,color:'#B42318'},total:{fontSize:18,fontWeight:'800',color:'#102A5C'},note:{fontSize:12,color:'#667085'},chips:{flexDirection:'row',flexWrap:'wrap',gap:8},chip:{borderWidth:1,borderColor:'#D0D5DD',borderRadius:999,paddingVertical:8,paddingHorizontal:12},chipActive:{backgroundColor:'#102A5C',borderColor:'#102A5C'},chipText:{color:'#344054'},chipTextActive:{color:'#fff'},error:{color:'#B42318',fontWeight:'600'},success:{color:'#027A48',fontWeight:'600'},disabled:{opacity:.5}});
