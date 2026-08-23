import { useEffect, useState } from 'react';
import { Link } from 'expo-router';
import { Alert, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ReadModelStatus } from '@/components/ReadModelStatus';
import { hasFreshMutationAuthorization } from '@/domain/mutationAuthorization';
import { LocalStore } from '@/offline/localStore';
import { cacheCustomers, getCachedCustomers, isSnapshotStale, OPERATIONAL_READ_MODEL_MAX_AGE_MS } from '@/offline/readModels';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { useOrganization } from '@/providers/OrganizationProvider';
import { archiveCustomer, createCustomer, loadCustomers, type Customer } from '@/services/coreCompletion';

const localStore = new LocalStore();

export default function CustomersScreen(){
  const {t,i18n}=useTranslation();
  const {organization,can,usingCachedData}=useOrganization();
  const {isOnline}=useConnectivity();
  const [customers,setCustomers]=useState<Customer[]>([]);const[name,setName]=useState('');const[phone,setPhone]=useState('');const[email,setEmail]=useState('');const[notes,setNotes]=useState('');const[busy,setBusy]=useState(false);const[loading,setLoading]=useState(true);const[error,setError]=useState(false);const[syncedAt,setSyncedAt]=useState<string|null>(null);const[usingCache,setUsingCache]=useState(false);
  const canRead=can('customer.read');const canManage=can('customer.manage');
  const mutationsAllowed=hasFreshMutationAuthorization(isOnline,usingCachedData);

  const refresh=async()=>{
    if(!organization||!canRead)return;
    setLoading(true);setError(false);
    if(!isOnline){const cached=getCachedCustomers(localStore,organization.id);setCustomers(cached?.data??[]);setSyncedAt(cached?.syncedAt??null);setUsingCache(true);setLoading(false);return;}
    try{const data=await loadCustomers(organization.id);const now=new Date().toISOString();cacheCustomers(localStore,organization.id,data,now);setCustomers(data);setSyncedAt(now);setUsingCache(false);}catch{const cached=getCachedCustomers(localStore,organization.id);if(cached){setCustomers(cached.data);setSyncedAt(cached.syncedAt);setUsingCache(true);}setError(true);}finally{setLoading(false);}
  };

  useEffect(()=>{const timer=setTimeout(()=>void refresh(),0);return()=>clearTimeout(timer);},[organization?.id,canRead,isOnline]);

  const add=async()=>{if(!organization||!name.trim()||!mutationsAllowed)return;setBusy(true);setError(false);try{await createCustomer({organizationId:organization.id,fullName:name,phone,email,preferredLocale:i18n.language==='en'?'en':'fr',notes});setName('');setPhone('');setEmail('');setNotes('');await refresh();}catch{setError(true);}finally{setBusy(false);}};
  const archive=async(id:string)=>{if(!mutationsAllowed)return;setBusy(true);try{await archiveCustomer(id);await refresh();}catch{setError(true);}finally{setBusy(false);}};
  const confirmArchive=(customer:Customer)=>Alert.alert(t('production.customers.archiveTitle'),t('production.customers.archiveConfirm',{name:customer.full_name}),[{text:t('common.cancel'),style:'cancel'},{text:t('sprint7.customers.archive'),style:'destructive',onPress:()=>void archive(customer.id)}]);

  if(!organization)return <SafeAreaView style={s.safe}><View style={s.center}><Text>{t('organization.noOrganization')}</Text></View></SafeAreaView>;
  if(!canRead)return <SafeAreaView style={s.safe}><View style={s.center}><Text>{t('sprint7.customers.cannotRead')}</Text><Link href="/">{t('organization.back')}</Link></View></SafeAreaView>;
  const stale=isSnapshotStale(syncedAt?{data:customers,syncedAt}:null,OPERATIONAL_READ_MODEL_MAX_AGE_MS);
  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.container}><View style={s.header}><View><Text accessibilityRole="header" style={s.title}>{t('sprint7.customers.title')}</Text><Text style={s.sub}>{t('sprint7.customers.subtitle')}</Text></View><Link href="/">{t('organization.back')}</Link></View><ReadModelStatus loading={loading} usingCachedData={usingCache} stale={stale} syncedAt={syncedAt} hasData={customers.length>0}/>{error?<Text accessibilityRole="alert" style={s.error}>{t('production.customers.refreshFailed')}</Text>:null}
  {canManage?<View style={s.card}><Text style={s.section}>{t('production.customers.addTitle')}</Text><TextInput editable={mutationsAllowed&&!busy} accessibilityLabel={t('sprint7.customers.name')} style={s.input} placeholder={t('sprint7.customers.name')} value={name} onChangeText={setName}/><TextInput editable={mutationsAllowed&&!busy} accessibilityLabel={t('sprint7.customers.phone')} style={s.input} placeholder={t('sprint7.customers.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad"/><TextInput editable={mutationsAllowed&&!busy} accessibilityLabel={t('sprint7.customers.email')} style={s.input} placeholder={t('sprint7.customers.email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"/><TextInput editable={mutationsAllowed&&!busy} accessibilityLabel={t('sprint7.customers.notes')} style={s.input} placeholder={t('sprint7.customers.notes')} value={notes} onChangeText={setNotes}/><Pressable accessibilityRole="button" disabled={busy||!name.trim()||!mutationsAllowed} onPress={()=>void add()} style={[s.primary,(!mutationsAllowed||busy||!name.trim())&&s.disabled]}><Text style={s.primaryText}>{busy?t('common.loading'):t('sprint7.customers.add')}</Text></Pressable>{!mutationsAllowed?<Text accessibilityRole="alert" style={s.meta}>{t(usingCachedData?'production.customers.freshAuthorizationRequired':'production.customers.onlineOnly')}</Text>:null}</View>:null}
  <View style={s.card}><Text style={s.section}>{t('sprint7.customers.title')}</Text>{loading&&customers.length===0?<Text style={s.meta}>{t('common.loading')}</Text>:customers.length===0?<Text style={s.meta}>{t('sprint7.customers.noCustomers')}</Text>:customers.map(c=><View key={c.id} style={s.row}><View style={s.grow}><Text style={s.bold}>{c.full_name}</Text><Text style={s.meta}>{[c.phone,c.email,c.preferred_locale.toUpperCase()].filter(Boolean).join(' · ')}</Text></View>{canManage?<Pressable accessibilityRole="button" accessibilityLabel={`${t('sprint7.customers.archive')} ${c.full_name}`} disabled={!mutationsAllowed||busy} onPress={()=>confirmArchive(c)} style={s.action}><Text style={[s.danger,(!mutationsAllowed||busy)&&s.disabledText]}>{t('sprint7.customers.archive')}</Text></Pressable>:null}</View>)}</View></ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:'#F6F8FC'},container:{padding:24,gap:16,maxWidth:900,width:'100%',alignSelf:'center'},center:{flex:1,alignItems:'center',justifyContent:'center',gap:12},header:{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',gap:12},title:{fontSize:28,fontWeight:'800',color:'#102A5C'},sub:{color:'#667085',marginTop:4},card:{backgroundColor:'#fff',padding:18,borderRadius:16,gap:12},section:{fontSize:18,fontWeight:'700',color:'#102A5C'},input:{borderWidth:1,borderColor:'#D0D5DD',borderRadius:10,padding:12,minHeight:44},primary:{backgroundColor:'#102A5C',padding:12,borderRadius:10,alignSelf:'flex-start',minHeight:44,justifyContent:'center'},primaryText:{color:'#fff',fontWeight:'700'},row:{flexDirection:'row',flexWrap:'wrap',gap:12,alignItems:'center',paddingVertical:10,borderBottomWidth:1,borderBottomColor:'#EAECF0'},grow:{flex:1,minWidth:200},action:{minHeight:44,justifyContent:'center'},bold:{fontWeight:'700',color:'#101828'},meta:{color:'#667085'},danger:{color:'#B42318',fontWeight:'700'},error:{color:'#B42318',fontWeight:'600'},disabled:{opacity:.5},disabledText:{opacity:.45}});
