import { useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/providers/AuthProvider';
import { useOrganization } from '@/providers/OrganizationProvider';

export default function HomeScreen() {
  const { t, i18n } = useTranslation();
  const { loading: authLoading, user, signIn, signOut } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const { organizations, organization, branches, branch, role, permissions, loading: organizationLoading, error, setOrganizationId, setBranchId, can } = useOrganization();

  const switchLanguage = async () => { await i18n.changeLanguage(i18n.language === 'fr' ? 'en' : 'fr'); };
  const submitSignIn = async () => { setAuthBusy(true); setAuthError(null); try { await signIn(email, password); setPassword(''); } catch (cause) { setAuthError(cause instanceof Error ? cause.message : 'AUTH_ERROR'); } finally { setAuthBusy(false); } };
  const submitSignOut = async () => { setAuthBusy(true); setAuthError(null); try { await signOut(); } catch (cause) { setAuthError(cause instanceof Error ? cause.message : 'AUTH_ERROR'); } finally { setAuthBusy(false); } };

  return <SafeAreaView style={styles.safeArea}><View style={styles.container}>
    <Text style={styles.brand}>{t('app.name')}</Text><Text style={styles.tagline}>{t('app.tagline')}</Text>
    {!authLoading && !user ? <View style={styles.card}><Text style={styles.title}>{t('auth.signIn')}</Text><TextInput accessibilityLabel={t('auth.email')} autoCapitalize="none" autoComplete="email" keyboardType="email-address" onChangeText={setEmail} placeholder={t('auth.email')} style={styles.input} value={email}/><TextInput accessibilityLabel={t('auth.password')} autoCapitalize="none" onChangeText={setPassword} placeholder={t('auth.password')} secureTextEntry style={styles.input} value={password}/>{authError ? <Text style={styles.error}>{authError}</Text> : null}<Pressable accessibilityRole="button" disabled={authBusy || !email || !password} onPress={() => void submitSignIn()} style={[styles.primaryButton,(authBusy || !email || !password)&&styles.disabled]}><Text style={styles.primaryButtonText}>{authBusy?t('common.loading'):t('auth.signIn')}</Text></Pressable></View> : null}
    {user ? <><View style={styles.card}><Text style={styles.title}>{t('foundation.title')}</Text><Text style={styles.body}>{t('foundation.subtitle')}</Text><Text style={styles.meta}>{t('foundation.database')}</Text><Text style={styles.meta}>{t('foundation.platforms')}</Text><Text style={styles.meta}>{user.email}</Text></View>
      <View style={styles.card}><Text style={styles.title}>{t('organization.title')}</Text>{organizationLoading?<Text style={styles.body}>{t('common.loading')}</Text>:null}{error?<Text style={styles.error}>{error}</Text>:null}{!organizationLoading&&organizations.length===0?<Text style={styles.body}>{t('organization.noOrganization')}</Text>:null}
        {organizations.length>1?<View style={styles.chips}>{organizations.map((item)=><Pressable key={item.id} onPress={()=>setOrganizationId(item.id)} style={[styles.chip,item.id===organization?.id&&styles.chipSelected]}><Text style={[styles.chipText,item.id===organization?.id&&styles.chipTextSelected]}>{item.name}</Text></Pressable>)}</View>:null}
        {organization?<><Text style={styles.organizationName}>{organization.name}</Text><Text style={styles.meta}>{t('organization.role')}: {role?(i18n.language==='fr'?role.name_fr:role.name_en):t('organization.noRole')}</Text><Text style={styles.sectionLabel}>{t('organization.branch')}</Text><View style={styles.chips}>{branches.map((item)=><Pressable key={item.id} onPress={()=>setBranchId(item.id)} style={[styles.chip,item.id===branch?.id&&styles.chipSelected]}><Text style={[styles.chipText,item.id===branch?.id&&styles.chipTextSelected]}>{item.name}</Text></Pressable>)}</View><Text style={styles.meta}>{t('organization.permissions')}: {permissions.length}</Text>
          <View style={styles.actions}>
            {can('inventory.read')?<Link href="/inventory" asChild><Pressable accessibilityRole="button" style={styles.primaryButton}><Text style={styles.primaryButtonText}>{t('inventory.manage')}</Text></Pressable></Link>:null}
            {can('purchase.read')?<Link href="/purchasing" asChild><Pressable accessibilityRole="button" style={styles.primaryButton}><Text style={styles.primaryButtonText}>{t('purchasing.manage')}</Text></Pressable></Link>:null}
            {can('inventory.read')?<Link href="/products" asChild><Pressable accessibilityRole="button" style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{t('catalog.manageProducts')}</Text></Pressable></Link>:null}
            {can('inventory.read')?<Link href="/batches" asChild><Pressable accessibilityRole="button" style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{t('catalog.manageBatches')}</Text></Pressable></Link>:null}
            {can('staff.manage')?<Link href="/staff" asChild><Pressable accessibilityRole="button" style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{t('organization.manageStaff')}</Text></Pressable></Link>:null}
            {can('branch.manage')?<Link href="/branches" asChild><Pressable accessibilityRole="button" style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{t('organization.manageBranches')}</Text></Pressable></Link>:null}
          </View></>:null}
      </View>
      {authError?<Text style={styles.error}>{authError}</Text>:null}<Pressable accessibilityRole="button" disabled={authBusy} onPress={()=>void submitSignOut()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{t('auth.signOut')}</Text></Pressable></>:null}
    <Pressable accessibilityRole="button" onPress={switchLanguage} style={styles.languageButton}><Text style={styles.primaryButtonText}>{i18n.language==='fr'?t('common.english'):t('common.french')}</Text></Pressable>
  </View></SafeAreaView>;
}

const styles=StyleSheet.create({safeArea:{flex:1,backgroundColor:'#F6F8FC'},container:{flex:1,padding:24,justifyContent:'center',gap:20,maxWidth:760,width:'100%',alignSelf:'center'},brand:{fontSize:28,fontWeight:'800',color:'#102A5C'},tagline:{fontSize:16,color:'#46536A'},card:{borderRadius:18,backgroundColor:'#FFFFFF',padding:24,gap:12,shadowColor:'#000',shadowOpacity:.08,shadowRadius:14,elevation:2},title:{fontSize:22,fontWeight:'700',color:'#102A5C'},organizationName:{fontSize:18,fontWeight:'700',color:'#102A5C'},sectionLabel:{fontSize:13,fontWeight:'700',color:'#46536A'},body:{fontSize:15,lineHeight:22,color:'#344159'},meta:{fontSize:14,color:'#667085'},error:{fontSize:14,color:'#9F1239'},input:{borderWidth:1,borderColor:'#D0D5DD',borderRadius:10,paddingVertical:12,paddingHorizontal:14,backgroundColor:'#FFFFFF',color:'#101828'},chips:{flexDirection:'row',flexWrap:'wrap',gap:8},chip:{borderWidth:1,borderColor:'#D0D5DD',borderRadius:999,paddingVertical:8,paddingHorizontal:12},chipSelected:{backgroundColor:'#102A5C',borderColor:'#102A5C'},chipText:{color:'#344159',fontWeight:'600',fontSize:13},chipTextSelected:{color:'#FFFFFF'},actions:{flexDirection:'row',flexWrap:'wrap',gap:10},primaryButton:{alignSelf:'flex-start',borderRadius:10,backgroundColor:'#102A5C',paddingVertical:12,paddingHorizontal:18},languageButton:{alignSelf:'flex-start',borderRadius:10,backgroundColor:'#00B8E6',paddingVertical:12,paddingHorizontal:18},primaryButtonText:{color:'#FFFFFF',fontWeight:'700'},secondaryButton:{alignSelf:'flex-start',borderWidth:1,borderColor:'#98A2B3',borderRadius:10,paddingVertical:10,paddingHorizontal:14},secondaryButtonText:{color:'#344159',fontWeight:'700'},disabled:{opacity:.45}});
