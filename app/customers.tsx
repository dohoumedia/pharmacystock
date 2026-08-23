import { useEffect, useState } from 'react';
import { Link } from 'expo-router';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useOrganization } from '@/providers/OrganizationProvider';
import { archiveCustomer, createCustomer, loadCustomers, type Customer } from '@/services/coreCompletion';

export default function CustomersScreen(){
  const {t,i18n}=useTranslation();
  const {organization,can}=useOrganization();
  const [customers,setCustomers]=useState<Customer[]>([]);const[name,setName]=useState('');const[phone,setPhone]=useState('');const[email,setEmail]=useState('');const[notes,setNotes]=useState('');const[busy,setBusy]=useState(false);const[error,setError]=useState<string|null>(null);
  const canRead=can('customer.read');const canManage=can('customer.manage');
  useEffect(()=>{if(!organization||!canRead)return;void loadCustomers(organization.id).then(setCustomers).catch((e)=>setError(e instanceof Error?e.message:String(e)));},[organization,canRead]);
  const refresh=async()=>{if(organization&&canRead)setCustomers(await loadCustomers(organization.id));};
  const add=async()=>{if(!organization||!name.trim())return;setBusy(true);setError(null);try{await createCustomer({organizationId:organization.id,fullName:name,phone,email,preferredLocale:i18n.language==='en'?'en':'fr',notes});setName('');setPhone('');setEmail('');setNotes('');await refresh();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
  if(!organization)return <SafeAreaView style={s.safe}><View style={s.center}><Text>{t('organization.noOrganization')}</Text></View></SafeAreaView>;
  if(!canRead)return <SafeAreaView style={s.safe}><View style={s.center}><Text>{t('sprint7.customers.cannotRead')}</Text><Link href="/">{t('organization.back')}</Link></View></SafeAreaView>;
  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.container}><View style={s.header}><View><Text style={s.title}>{t('sprint7.customers.title')}</Text><Text style={s.sub}>{t('sprint7.customers.subtitle')}</Text></View><Link href="/">{t('organization.back')}</Link></View>{error?<Text style={s.error}>{error}</Text>:null}
  {canManage?<View style={s.card}><TextInput style={s.input} placeholder={t('sprint7.customers.name')} value={name} onChangeText={setName}/><TextInput style={s.input} placeholder={t('sprint7.customers.phone')} value={phone} onChangeText={setPhone}/><TextInput style={s.input} placeholder={t('sprint7.customers.email')} value={email} onChangeText={setEmail} autoCapitalize="none"/><TextInput style={s.input} placeholder={t('sprint7.customers.notes')} value={notes} onChangeText={setNotes}/><Pressable disabled={busy||!name.trim()} onPress={()=>void add()} style={s.primary}><Text style={s.primaryText}>{busy?t('common.loading'):t('sprint7.customers.add')}</Text></Pressable></View>:null}
  <View style={s.card}>{customers.length===0?<Text style={s.meta}>{t('sprint7.customers.noCustomers')}</Text>:customers.map(c=><View key={c.id} style={s.row}><View style={{flex:1}}><Text style={s.bold}>{c.full_name}</Text><Text style={s.meta}>{[c.phone,c.email,c.preferred_locale.toUpperCase()].filter(Boolean).join(' · ')}</Text></View>{canManage?<Pressable onPress={()=>void archiveCustomer(c.id).then(refresh)}><Text style={s.danger}>{t('sprint7.customers.archive')}</Text></Pressable>:null}</View>)}</View></ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:'#F6F8FC'},container:{padding:24,gap:16,maxWidth:900,width:'100%',alignSelf:'center'},center:{flex:1,alignItems:'center',justifyContent:'center',gap:12},header:{flexDirection:'row',justifyContent:'space-between',gap:12},title:{fontSize:28,fontWeight:'800',color:'#102A5C'},sub:{color:'#667085',marginTop:4},card:{backgroundColor:'#fff',padding:18,borderRadius:16,gap:12},input:{borderWidth:1,borderColor:'#D0D5DD',borderRadius:10,padding:12},primary:{backgroundColor:'#102A5C',padding:12,borderRadius:10,alignSelf:'flex-start'},primaryText:{color:'#fff',fontWeight:'700'},row:{flexDirection:'row',gap:12,alignItems:'center',paddingVertical:10,borderBottomWidth:1,borderBottomColor:'#EAECF0'},bold:{fontWeight:'700',color:'#101828'},meta:{color:'#667085'},danger:{color:'#B42318',fontWeight:'700'},error:{color:'#B42318',fontWeight:'600'}});
