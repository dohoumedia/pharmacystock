import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { Text, View } from 'react-native';
import { useTranslation } from '../i18n/useTranslation';
import { Alert, Button, FormField, Surface, TextField } from './ui';
import { CatalogSelector } from './CatalogSelector';
import { ExpiryBatchSummary, ExpiryHistoryDetail, expiryErrorKey } from './ExpiryBatchDetails';
import { InventoryFormStore } from '../domain/inventoryCompletion';
import { expiryActionAllowed, expiryActionQuantity, isStockRemoval, type ExpiryOperation, type ExpiryRequest } from '../domain/expiryCompletion';
import { isDefinitiveRejection } from '../domain/numericInput';
import { stockUnitLabel } from '../domain/stockUnits';
import { searchBatches } from '../services/catalogReadiness';
import { loadInventoryBatch } from '../services/inventoryCompletion';
import { findExpiryResult, loadAffectedLot, loadExpiryActionDetail, loadExpirySuppliers, submitExpiryRequest } from '../services/expiryCompletion';

type Context = Awaited<ReturnType<typeof loadInventoryBatch>>;
type Props = { scope: string; organizationId: string; branchId: string; branchName: string; branches: { id: string; name: string }[]; selectedBatchId: string | null; writable: boolean; online: boolean; revision: string | null; canManage: boolean; canDispose: boolean; onSaved: () => Promise<void>; onSelectBatch: (id: string) => void; onNavigate: (branchId: string, batchId: string) => void };
export function ExpiryWorkbench({ scope, organizationId, branchId, branchName, branches, selectedBatchId, writable, online, revision, canManage, canDispose, onSaved, onNavigate, onSelectBatch }: Props) {
  const { t, i18n } = useTranslation();
  const translate = useRef(t);
  useEffect(() => { translate.current = t; }, [t]);
  const store = useMemo(() => new InventoryFormStore(), []);
  const key = `expiry:${scope}`;
  const [ready, setReady] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [context, setContext] = useState<Context | null>(null);
  const [operation, setOperation] = useState<ExpiryOperation>(canManage ? 'QUARANTINE' : 'DISPOSE');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [request, setRequest] = useState<ExpiryRequest | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof loadExpiryActionDetail>> | null>(null);
  const [locations, setLocations] = useState<Context[] | null>(null);
  const [suppliers, setSuppliers] = useState<string[] | null>(null);
  const [supplierError, setSupplierError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flight = useRef(false);
  const selection = useRef(0);
  const select = useCallback(async (id: string) => {
    const ticket = ++selection.current;
    setContext(null); setLocations(null); setSuppliers(null); setSupplierError(false); setConfirm(false); setQuantity(''); setReason(''); setReference(''); setError(null);
    try { const current = await loadInventoryBatch(organizationId, branchId, id); if (selection.current === ticket) { setContext(current); setSearchOpen(false); } }
    catch (cause) { if (selection.current === ticket) setError(translate.current(expiryErrorKey(cause))); }
  }, [organizationId, branchId]);
  useEffect(() => { const timer = setTimeout(() => { try { setRequest(store.get<ExpiryRequest>(key)); setReady(true); } catch (cause) { setError(t(expiryErrorKey(cause))); } }, 0); return () => clearTimeout(timer); }, [key, store, t]);
  useEffect(() => { if (!ready || request || !selectedBatchId) return; const timer = setTimeout(() => void select(selectedBatchId), 0); return () => clearTimeout(timer); }, [ready, request, selectedBatchId, select]);
  const persist = (value: ExpiryRequest) => { store.set(key, value); setRequest(value); };
  const inspect = async (value: ExpiryRequest) => {
    const action = await findExpiryResult(value);
    if (!action) throw new Error('EXPIRY_STATUS_UNCERTAIN');
    const next = await loadExpiryActionDetail(organizationId, branchId, action);
    setDetail(next); setContext({ batch: next.batch, balance: next.balance });
  };
  const review = () => {
    setError(null);
    try {
      if (!context) throw new Error('EXPIRY_BALANCE_UNAVAILABLE');
      expiryActionQuantity(operation, quantity, reason, context.batch, context.balance, organizationId, branchId);
      setConfirm(true);
    } catch (cause) { setError(t(expiryErrorKey(cause))); }
  };
  const submit = async () => {
    if (flight.current || !writable || !ready || !((request?.action ?? operation) === 'DISPOSE' ? canDispose : canManage)) return;
    flight.current = true; setBusy(true); setError(null);
    let saved = request;
    try {
      if (!saved) {
        if (!confirm || !context) return;
        const amount = expiryActionQuantity(operation, quantity, reason, context.batch, context.balance, organizationId, branchId);
        saved = { organizationId, branchId, batch: context.batch, action: operation, quantity: amount, reason: reason.trim(), reference: reference.trim(), idempotencyKey: `expiry-operation:${randomUUID()}`, createdAt: new Date().toISOString(), observedOnHand: Number(context.balance!.on_hand_quantity), phase: 'prepared' };
        persist(saved);
      }
      if (!(saved.action === 'DISPOSE' ? canDispose : canManage)) return;
      const id = await submitExpiryRequest(saved, organizationId, branchId, () => { saved = { ...saved!, phase: 'dispatched' }; persist(saved); });
      saved = { ...saved, resultId: id, rejected: false }; persist(saved);
      setConfirm(false);
      await inspect(saved); await onSaved();
    } catch (cause) {
      const local = cause instanceof Error && /EXPIRY_(ACTION_INELIGIBLE|STOCK_CHANGED|REASON_REQUIRED|BALANCE_UNAVAILABLE)|INVENTORY_(QUANTITY_INVALID|BRANCH_CHANGED)|INSUFFICIENT_STOCK/.test(cause.message);
      if (saved && !saved.resultId && (isDefinitiveRejection(cause) || local)) persist({ ...saved, rejected: true });
      setError(t(expiryErrorKey(cause)));
    } finally { flight.current = false; setBusy(false); }
  };
  const finish = async () => {
    if (!request) return;
    try {
      store.set(`expiry-history:${scope}:${request.idempotencyKey}`, request); store.remove(key);
      setRequest(null); setDetail(null); setConfirm(false); setReason(''); setQuantity(''); setReference(''); setError(null);
      onSelectBatch(request.batch.id);
    } catch (cause) { setError(t(expiryErrorKey(cause))); }
  };
  const contextBatchId = context?.batch.id;
  useEffect(() => {
    if (!online || !contextBatchId || request) return;
    let active = true;
    void loadInventoryBatch(organizationId, branchId, contextBatchId).then((current) => { if (active) { setContext(current); setConfirm(false); } }).catch((cause: unknown) => { if (active) setError(t(expiryErrorKey(cause))); });
    return () => { active = false; };
  }, [revision, contextBatchId, organizationId, branchId, online, request, t]);
  const locked = !ready || busy || !writable || Boolean(request) || confirm;
  const batch = context?.batch;
  const number = (value: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 4 }).format(value);
  return <Surface style={{ gap: 12 }}><Text accessibilityRole="header" style={{ fontWeight: '800', fontSize: 20 }}>{t('expiry.actions')}</Text><Text>{t('organization.branch')}: {branchName}</Text><Text>{t('expiryReady.branchBound')}</Text>
    {error ? <Alert tone="danger" title={error} /> : null}
    {request ? <>
      <Text style={{ fontWeight: '800' }}>{t(request.resultId ? 'expiryReady.accepted' : request.rejected ? 'expiryReady.rejected' : 'expiryReady.uncertain')}</Text><Text>{request.batch.product_name} · {request.batch.lot_number}</Text><Text>{t(`expiry.action.${request.action}`)}</Text><Text>{t('expiryReady.reason')}: {request.reason}</Text><Text>{t('expiryReady.reference')}: {request.reference || '—'}</Text><Text>{t('expiryReady.operationReference')}: {request.idempotencyKey}</Text>{request.quantity !== null ? <Text>{t('expiryReady.reviewedQuantity')}: {number(request.quantity)} {stockUnitLabel(request.batch.stock_unit, t)}</Text> : null}
      {request.resultId ? <><Text>{t('expiryReady.actionReference')}: {request.resultId}</Text>{detail ? <ExpiryHistoryDetail detail={detail} branchName={branchName} /> : <Text>{t('expiryReady.detailRetry')}</Text>}<Button disabled={!online || busy} label={t('expiryReady.refreshResult')} onPress={() => { void inspect(request).then(onSaved).catch((cause: unknown) => setError(t(expiryErrorKey(cause)))); }} /></> : !request.rejected ? <><Text>{t(request.phase === 'prepared' ? 'expiryReady.preparedHint' : isStockRemoval(request.action) ? 'expiryReady.retryHint' : 'expiryReady.statusUncertain')}</Text><Button disabled={!writable || busy} loading={busy} label={t(request.phase === 'prepared' ? 'expiryReady.continuePrepared' : isStockRemoval(request.action) ? 'expiryReady.retryExact' : 'expiryReady.recoverStatus')} onPress={() => void submit()} /></> : null}
      {request.resultId || request.rejected ? <Button disabled={busy} variant="secondary" label={t(request.rejected ? 'expiryReady.correct' : 'expiryReady.newAction')} onPress={() => void finish()} /> : null}
    </> : <>
      {!context || searchOpen ? <CatalogSelector scope={scope} label={t('expiryReady.search')} disabled={locked} selectedLabel={batch ? `${batch.product_name} · ${batch.lot_number}` : undefined} load={(query, page) => searchBatches(organizationId, branchId, query, page)} renderLabel={(item) => `${item.product_name} · ${item.lot_number}`} onSelect={(item) => { if (item.id === selectedBatchId) { if (!context) void select(item.id); else setSearchOpen(false); } else { onSelectBatch(item.id); } }} /> : <Button disabled={locked} variant="secondary" label={t('expiryReady.chooseBatch')} onPress={() => setSearchOpen(true)} />}
      {context ? <ExpiryBatchSummary {...context} branchName={branchName} /> : <Text>{t('expiryReady.selectBatch')}</Text>}
      {batch ? <>
        <Text>{t('expiryReady.fefoHint')}</Text>
        <Button disabled={!online || busy} variant="secondary" label={t('expiryReady.findLocations')} onPress={() => { setError(null); void loadAffectedLot(organizationId, batch.product_id, batch.lot_number).then(setLocations).catch((cause: unknown) => setError(t(expiryErrorKey(cause)))); }} />
        {locations ? <View style={{ gap: 12 }}><Text>{t('expiryReady.scopeHint')}</Text>{locations.map((location) => <View key={location.batch.id} style={{ gap: 6 }}><ExpiryBatchSummary {...location} branchName={branches.find((item) => item.id === location.batch.branch_id)?.name ?? location.batch.branch_id} /><Button disabled={busy || confirm} label={t('expiryReady.openLocation')} variant="secondary" onPress={() => onNavigate(location.batch.branch_id, location.batch.id)} /></View>)}</View> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(['PRIORITIZE_SALE', 'QUARANTINE', 'RELEASE_QUARANTINE', 'RECALL', 'SUPPLIER_RETURN', 'DISPOSE'] as const).filter((action) => action === 'DISPOSE' ? canDispose : canManage).map((action) => <Button key={action} disabled={locked || !expiryActionAllowed(action, batch, context.balance)} label={t(`expiry.action.${action}`)} variant={operation === action ? 'primary' : 'secondary'} accessibilityState={{ selected: operation === action }} onPress={() => { setOperation(action); setConfirm(false); }} />)}</View>
        {operation === 'DISPOSE' ? <Alert tone="warning" title={t('expiryReady.wholeBatchOnly')}><Text>{t('expiryReady.wholeBatchHint')}</Text></Alert> : null}
        {operation === 'SUPPLIER_RETURN' ? <>
          <Button disabled={!online || busy} variant="secondary" label={t('expiryReady.loadSupplier')} onPress={() => { setSupplierError(false); void loadExpirySuppliers(organizationId, branchId, batch.id).then(setSuppliers).catch(() => setSupplierError(true)); }} />
          <Text>{t('purchasing.supplier')}: {supplierError ? t('expiryReady.supplierUnavailable') : suppliers === null ? t('expiryReady.supplierNotLoaded') : suppliers.length ? suppliers.join(' · ') : t('expiryReady.noSupplier')}</Text><Text>{t('expiryReady.returnHint')}</Text>
          <FormField label={`${t('inventory.quantity')} (${stockUnitLabel(batch.stock_unit, t)})`} required><TextField accessibilityLabel={t('expiryReady.returnQuantity')} keyboardType="decimal-pad" editable={!locked} value={quantity} onChangeText={setQuantity} /></FormField>
        </> : null}
        <FormField label={t('expiryReady.reason')} required><TextField accessibilityLabel={t('expiryReady.reason')} editable={!locked} value={reason} onChangeText={setReason} /></FormField>
        <FormField label={t('expiryReady.reference')}><TextField accessibilityLabel={t('expiryReady.reference')} editable={!locked} value={reference} onChangeText={setReference} /></FormField>
        {confirm ? <Surface tone="attention" style={{ gap: 10 }}><Text style={{ fontWeight: '800' }}>{t('expiryReady.confirmTitle')}</Text><Text>{branchName} · {batch.product_name} · {batch.lot_number}</Text><Text>{t(`expiry.action.${operation}`)} · {operation === 'DISPOSE' ? `${number(Number(context.balance!.on_hand_quantity))} ${stockUnitLabel(batch.stock_unit, t)}` : operation === 'SUPPLIER_RETURN' ? `${quantity} ${stockUnitLabel(batch.stock_unit, t)}` : t('expiryReady.statusOnly')}</Text><Text>{reason} · {reference}</Text>{operation === 'DISPOSE' ? <Text>{t('expiryReady.wholeBatchHint')}</Text> : null}<Button label={t('expiryReady.confirmAction')} disabled={busy || !writable} loading={busy} onPress={() => void submit()} /><Button variant="secondary" label={t('common.cancel')} disabled={busy} onPress={() => setConfirm(false)} /></Surface> : <Button label={t('expiryReady.review')} disabled={locked} onPress={review} />}
      </> : null}
    </>}
  </Surface>;
}
