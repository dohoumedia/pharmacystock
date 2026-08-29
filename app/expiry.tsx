import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'expo-router';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatDateOnly } from '@/utils/dateFormatting';
import { ReadModelStatus } from '@/components/ReadModelStatus';
import { BatchStatusBadge } from '@/components/BatchStatusBadge';
import { LocalStore } from '@/offline/localStore';
import { cacheExpiryReadModel, getCachedExpiryReadModel } from '@/offline/expiryTransfersReadModels';
import { isSnapshotStale, OPERATIONAL_READ_MODEL_MAX_AGE_MS } from '@/offline/readModels';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { useOrganization } from '@/providers/OrganizationProvider';
import {
  acknowledgeExpiryAlert,
  disposeBatch,
  loadExpiryActions,
  loadExpiryAlerts,
  loadExpiryPolicy,
  loadExpiryRisk,
  recordExpiryAction,
  refreshExpiryAlerts,
  returnBatchToSupplier,
  saveExpiryPolicy,
  type ExpiryAction,
  type ExpiryAlert,
  type ExpiryRisk,
} from '@/services/expiry';

const localStore = new LocalStore();

export default function ExpiryScreen() {
  const { t, i18n } = useTranslation();
  const { isOnline } = useConnectivity();
  const { organization, branch, branches, setBranchId, can, usingCachedData: usingCachedPermissions } = useOrganization();
  const [risk, setRisk] = useState<ExpiryRisk[]>([]);
  const [alerts, setAlerts] = useState<ExpiryAlert[]>([]);
  const [actions, setActions] = useState<ExpiryAction[]>([]);
  const [thresholds, setThresholds] = useState('180, 90, 60, 30, 7');
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [returnQuantity, setReturnQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [confirmDispose, setConfirmDispose] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [usingCachedData, setUsingCachedData] = useState(false);

  const canRead = can('inventory.read');
  const canManage = can('inventory.expiry.manage');
  const canDispose = can('inventory.dispose');
  const mutationAllowed = isOnline && !usingCachedPermissions;

  const refresh = useCallback(async () => {
    if (!organization || !branch || !canRead) return;
    const cached = getCachedExpiryReadModel(localStore, organization.id, branch.id);
    if (cached) {
      setRisk(cached.data.risk); setAlerts(cached.data.alerts); setActions(cached.data.actions);
      if (cached.data.policy) setThresholds(cached.data.policy.thresholds_days.join(', '));
      setSyncedAt(cached.syncedAt); setUsingCachedData(true);
    }
    if (!isOnline) { if (!cached) setError(t('production.readModel.noCachedData')); return; }
    setLoading(true);
    setError(null);
    try {
      await refreshExpiryAlerts(organization.id, branch.id);
      const [nextRisk, nextAlerts, nextActions, policy] = await Promise.all([
        loadExpiryRisk(organization.id, branch.id),
        loadExpiryAlerts(organization.id, branch.id),
        loadExpiryActions(organization.id, branch.id),
        loadExpiryPolicy(organization.id),
      ]);
      setRisk(nextRisk);
      setAlerts(nextAlerts);
      setActions(nextActions);
      cacheExpiryReadModel(localStore, organization.id, branch.id, { risk: nextRisk, alerts: nextAlerts, actions: nextActions, policy });
      setSyncedAt(new Date().toISOString()); setUsingCachedData(false);
      if (policy) setThresholds(policy.thresholds_days.join(', '));
      setSelectedBatchId((current) => current && nextRisk.some((item) => item.batch_id === current) ? current : nextRisk[0]?.batch_id ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR');
    } finally {
      setLoading(false);
    }
  }, [branch, canRead, isOnline, organization, t]);

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const byBatch = useMemo(() => new Map(risk.map((item) => [item.batch_id, item])), [risk]);
  const selected = selectedBatchId ? byBatch.get(selectedBatchId) ?? null : null;
  const counts = useMemo(() => risk.reduce<Record<string, number>>((acc, item) => {
    const key = item.risk_bucket ?? 'OK';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {}), [risk]);
  const valueAtRisk = useMemo(() => risk.filter((item) => item.risk_bucket !== 'OK').reduce((sum, item) => sum + Number(item.value_at_risk ?? 0), 0), [risk]);

  const runAction = async (action: 'PRIORITIZE_SALE' | 'QUARANTINE' | 'RELEASE_QUARANTINE') => {
    if (!selected?.batch_id || !mutationAllowed) return;
    setSaving(true); setError(null);
    try {
      await recordExpiryAction(selected.batch_id, action, reason);
      setReason('');
      setConfirmDispose(false);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR'); }
    finally { setSaving(false); }
  };

  const submitReturn = async () => {
    if (!selected?.batch_id || !mutationAllowed) return;
    const quantity = Number(returnQuantity);
    const onHand = Number(selected.on_hand_quantity ?? 0);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > onHand) return;
    setSaving(true); setError(null);
    try {
      await returnBatchToSupplier(selected.batch_id, onHand, quantity, reason);
      setReturnQuantity(''); setReason('');
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR'); }
    finally { setSaving(false); }
  };

  const submitDispose = async () => {
    if (!selected?.batch_id || !mutationAllowed) return;
    if (!confirmDispose) { setConfirmDispose(true); return; }
    setSaving(true); setError(null);
    try {
      await disposeBatch(selected.batch_id, Number(selected.on_hand_quantity ?? 0), reason);
      setConfirmDispose(false); setReason('');
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR'); }
    finally { setSaving(false); }
  };

  const submitPolicy = async () => {
    if (!organization || !mutationAllowed) return;
    const parsed = thresholds.split(',').map((item) => Number(item.trim())).filter((value) => Number.isInteger(value) && value > 0);
    setSaving(true); setError(null);
    try {
      const saved = await saveExpiryPolicy(organization.id, parsed);
      setThresholds(saved.thresholds_days.join(', '));
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR'); }
    finally { setSaving(false); }
  };

  const acknowledge = async (alertId: string) => {
    if (!mutationAllowed) return;
    setSaving(true); setError(null);
    try { await acknowledgeExpiryAlert(alertId); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR'); }
    finally { setSaving(false); }
  };

  if (!canRead) {
    return <SafeAreaView style={styles.safeArea}><View style={styles.container}><Text style={styles.error}>{t('expiry.cannotRead')}</Text><Link href="/">{t('organization.back')}</Link></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <View style={styles.grow}><Text style={styles.title}>{t('expiry.title')}</Text><Text style={styles.subtitle}>{t('expiry.subtitle')}</Text></View>
          <Link href="/" asChild><Pressable style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{t('organization.back')}</Text></Pressable></Link>
        </View>

        <Text style={styles.label}>{t('organization.branch')}</Text>
        <View accessibilityRole="tablist" style={styles.chips}>{branches.map((item) => <Pressable accessibilityRole="tab" accessibilityState={{ selected: item.id === branch?.id }} key={item.id} onPress={() => setBranchId(item.id)} style={[styles.chip, item.id === branch?.id && styles.chipSelected]}><Text style={[styles.chipText, item.id === branch?.id && styles.chipTextSelected]}>{item.name}</Text></Pressable>)}</View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <ReadModelStatus loading={loading} usingCachedData={usingCachedData} stale={isSnapshotStale(syncedAt ? { data: null, syncedAt } : null, OPERATIONAL_READ_MODEL_MAX_AGE_MS)} syncedAt={syncedAt} hasData={risk.length + alerts.length + actions.length > 0} />
        {!mutationAllowed ? <Text accessibilityRole="alert" style={styles.error}>{t('production.authorizationReadOnly')}</Text> : null}

        <View style={styles.metricGrid}>
          {['EXPIRED','7_DAYS','30_DAYS','60_DAYS','90_DAYS','180_DAYS'].map((bucket) => <View key={bucket} style={styles.metric}><Text style={styles.metricValue}>{counts[bucket] ?? 0}</Text><Text style={styles.meta}>{t(`expiry.bucket.${bucket}`)}</Text></View>)}
          <View style={styles.metric}><Text style={styles.metricValue}>{Math.round(valueAtRisk).toLocaleString()} {organization?.currency_code ?? ''}</Text><Text style={styles.meta}>{t('expiry.valueAtRisk')}</Text></View>
        </View>

        <View accessibilityRole="summary" style={styles.card}>
          <Text style={styles.sectionTitle}>{t('catalog.status')}</Text>
          <View style={styles.chips}>
            <BatchStatusBadge status="ACTIVE" />
            <BatchStatusBadge status="EXPIRED" />
            <BatchStatusBadge status="QUARANTINED" />
            <BatchStatusBadge status="RECALLED" />
            <BatchStatusBadge status="DISPOSED" />
          </View>
        </View>

        {canManage ? <View style={styles.card}><Text style={styles.sectionTitle}>{t('expiry.policy')}</Text><Text style={styles.meta}>{t('expiry.policyHint')}</Text><TextInput editable={mutationAllowed} style={styles.input} value={thresholds} onChangeText={setThresholds} placeholder="180, 90, 60, 30, 7"/><Pressable disabled={saving||!mutationAllowed} onPress={() => void submitPolicy()} style={[styles.primaryButton,(saving||!mutationAllowed)&&styles.disabled]}><Text style={styles.primaryButtonText}>{t('common.save')}</Text></Pressable></View> : null}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('expiry.riskList')}</Text>
          {!loading && risk.length === 0 ? <Text style={styles.meta}>{t('expiry.noRisk')}</Text> : null}
          {risk.map((item) => <Pressable accessibilityRole="button" accessibilityState={{ selected: item.batch_id === selectedBatchId }} key={item.batch_id ?? `${item.product_id}-${item.lot_number}`} onPress={() => { setSelectedBatchId(item.batch_id); setConfirmDispose(false); }} style={[styles.riskRow,item.batch_id===selectedBatchId&&styles.riskRowSelected]}>
            <View style={styles.grow}><Text style={styles.name}>{item.product_name}</Text><Text style={styles.meta}>{t('catalog.lotNumber')}: {item.lot_number} · {t('expiry.expires')}: {formatDateOnly(item.expiry_date, i18n.language)}</Text></View>
            <View><Text style={styles.quantity}>{item.on_hand_quantity}</Text><Text style={styles.meta}>{t(`expiry.bucket.${item.risk_bucket ?? 'OK'}`)}</Text></View>
          </Pressable>)}
        </View>

        {selected && canManage ? <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('expiry.actions')}</Text>
          <Text style={styles.name}>{selected.product_name} · {selected.lot_number}</Text>
          <Text style={styles.meta}>{t('inventory.onHand')}: {selected.on_hand_quantity} · {t('expiry.daysRemaining')}: {selected.days_remaining}</Text>
          <TextInput editable={mutationAllowed} style={styles.input} placeholder={t('expiry.reason')} value={reason} onChangeText={setReason}/>
          <View style={styles.actions}>
            {selected.batch_status === 'ACTIVE' && Number(selected.days_remaining ?? -1) >= 0 ? <Pressable disabled={saving||!mutationAllowed} onPress={() => void runAction('PRIORITIZE_SALE')} style={[styles.secondaryButton,!mutationAllowed&&styles.disabled]}><Text style={styles.secondaryButtonText}>{t('expiry.prioritizeSale')}</Text></Pressable> : null}
            {selected.batch_status === 'ACTIVE' ? <Pressable disabled={saving||!mutationAllowed} onPress={() => void runAction('QUARANTINE')} style={[styles.secondaryButton,!mutationAllowed&&styles.disabled]}><Text style={styles.secondaryButtonText}>{t('expiry.quarantine')}</Text></Pressable> : null}
            {selected.batch_status === 'QUARANTINED' && Number(selected.days_remaining ?? -1) >= 0 ? <Pressable disabled={saving||!mutationAllowed} onPress={() => void runAction('RELEASE_QUARANTINE')} style={[styles.secondaryButton,!mutationAllowed&&styles.disabled]}><Text style={styles.secondaryButtonText}>{t('expiry.releaseQuarantine')}</Text></Pressable> : null}
          </View>
          <View style={styles.returnRow}><TextInput editable={mutationAllowed} keyboardType="decimal-pad" style={styles.smallInput} placeholder={t('expiry.returnQuantity')} value={returnQuantity} onChangeText={setReturnQuantity}/><Pressable disabled={saving || !returnQuantity || !mutationAllowed} onPress={() => void submitReturn()} style={[styles.secondaryButton,!mutationAllowed&&styles.disabled]}><Text style={styles.secondaryButtonText}>{t('expiry.returnSupplier')}</Text></Pressable></View>
          {canDispose ? <View style={styles.actions}><Pressable disabled={saving||!mutationAllowed} onPress={() => void submitDispose()} style={[styles.dangerButton,confirmDispose&&styles.dangerConfirm,!mutationAllowed&&styles.disabled]}><Text style={styles.dangerText}>{confirmDispose?t('expiry.confirmDispose'):t('expiry.dispose')}</Text></Pressable>{confirmDispose?<Pressable onPress={() => setConfirmDispose(false)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{t('common.cancel')}</Text></Pressable>:null}</View> : null}
        </View> : null}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('expiry.alerts')}</Text>
          {alerts.length === 0 ? <Text style={styles.meta}>{t('expiry.noAlerts')}</Text> : alerts.map((alert) => { const item=byBatch.get(alert.batch_id); return <View key={alert.id} style={styles.alertRow}><View style={styles.grow}><Text style={styles.name}>{item?.product_name ?? alert.batch_id.slice(0,8)}</Text><Text style={styles.meta}>{alert.alert_type==='EXPIRED'?t('expiry.expired'):t('expiry.warning',{days:alert.threshold_days})} · {alert.status}</Text></View>{canManage&&alert.status==='OPEN'?<Pressable disabled={saving||!mutationAllowed} onPress={() => void acknowledge(alert.id)} style={[styles.secondaryButton,!mutationAllowed&&styles.disabled]}><Text style={styles.secondaryButtonText}>{t('expiry.acknowledge')}</Text></Pressable>:null}</View>; })}
        </View>

        <View style={styles.card}><Text style={styles.sectionTitle}>{t('expiry.recentActions')}</Text>{actions.length===0?<Text style={styles.meta}>{t('expiry.noActions')}</Text>:actions.map((action)=><View key={action.id} style={styles.alertRow}><Text style={styles.name}>{t(`expiry.action.${action.action_type}`)}</Text><Text style={styles.meta}>{new Date(action.created_at).toLocaleString()}{action.quantity!=null?` · ${action.quantity}`:''}</Text></View>)}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles=StyleSheet.create({
  safeArea:{flex:1,backgroundColor:'#F6F8FC'},container:{padding:24,gap:18,maxWidth:1100,width:'100%',alignSelf:'center'},headerRow:{flexDirection:'row',gap:12,alignItems:'center'},grow:{flex:1},title:{fontSize:28,fontWeight:'800',color:'#102A5C'},subtitle:{color:'#667085',marginTop:4},label:{fontSize:13,fontWeight:'700',color:'#475467'},meta:{color:'#667085',fontSize:13},error:{color:'#B42318'},card:{backgroundColor:'#FFF',borderRadius:16,padding:18,gap:12},sectionTitle:{fontSize:20,fontWeight:'700',color:'#102A5C'},metricGrid:{flexDirection:'row',flexWrap:'wrap',gap:10},metric:{backgroundColor:'#FFF',borderRadius:14,padding:14,minWidth:130},metricValue:{fontSize:20,fontWeight:'800',color:'#102A5C'},chips:{flexDirection:'row',flexWrap:'wrap',gap:8},chip:{minHeight:44,justifyContent:'center',borderWidth:1,borderColor:'#D0D5DD',borderRadius:999,paddingVertical:8,paddingHorizontal:12},chipSelected:{backgroundColor:'#102A5C',borderColor:'#102A5C'},chipText:{fontSize:13,fontWeight:'600',color:'#344054'},chipTextSelected:{color:'#FFF'},riskRow:{minHeight:44,flexDirection:'row',alignItems:'center',gap:12,padding:12,borderRadius:10,borderWidth:1,borderColor:'#EAECF0'},riskRowSelected:{borderColor:'#102A5C',backgroundColor:'#F4F7FC'},name:{fontWeight:'700',color:'#101828'},quantity:{fontWeight:'800',fontSize:18,color:'#101828',textAlign:'right'},input:{minHeight:44,borderWidth:1,borderColor:'#D0D5DD',borderRadius:10,padding:11,color:'#101828'},smallInput:{minHeight:44,width:150,borderWidth:1,borderColor:'#D0D5DD',borderRadius:10,padding:10},actions:{flexDirection:'row',flexWrap:'wrap',gap:8},returnRow:{flexDirection:'row',gap:8,alignItems:'center'},alertRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,paddingVertical:10,borderBottomWidth:1,borderBottomColor:'#EAECF0'},primaryButton:{minHeight:44,justifyContent:'center',alignSelf:'flex-start',backgroundColor:'#102A5C',borderRadius:10,paddingVertical:11,paddingHorizontal:16},primaryButtonText:{color:'#FFF',fontWeight:'700'},secondaryButton:{minHeight:44,justifyContent:'center',alignSelf:'flex-start',borderWidth:1,borderColor:'#98A2B3',borderRadius:10,paddingVertical:10,paddingHorizontal:14},secondaryButtonText:{color:'#344054',fontWeight:'700'},dangerButton:{minHeight:44,justifyContent:'center',alignSelf:'flex-start',borderWidth:1,borderColor:'#B42318',borderRadius:10,paddingVertical:10,paddingHorizontal:14},dangerConfirm:{backgroundColor:'#B42318'},dangerText:{color:'#B42318',fontWeight:'700'},disabled:{opacity:.45}
});
