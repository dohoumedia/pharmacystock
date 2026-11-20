import { useBusinessTimezone } from '../hooks/useBusinessTimezone';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useTranslation } from '../i18n/useTranslation';
import { CatalogSelector } from './CatalogSelector';
import { Alert, Button, FormField, Surface, TextField } from './ui';
import { BatchIdentity, MovementDetail, inventoryErrorKey } from './InventoryResultDetails';
import { searchBatches, type BatchChoice } from '@/services/catalogReadiness';
import { ensureStockCount, listStockCounts, loadCountDetail, loadInventoryBatch, reconcileInventoryCount, saveCountDraft } from '@/services/inventoryCompletion';
import { countValues, InventoryFormStore, inventoryQuantity, variance, type CountDraft } from '../domain/inventoryCompletion';
import { isDefinitiveRejection } from '../domain/numericInput';
import type { InventoryMovement, StockCount } from '@/services/inventory';
import { stockUnitLabel } from '../domain/stockUnits';
import { formatInstantDateTime } from '../utils/dateFormatting';

type Props = { initialCountId?: string; scope: string; organizationId: string; branchId: string; branchName: string; writable: boolean; canCount: boolean; online: boolean; onSaved: () => Promise<void> };
export function CountVariance({ draft }: { draft: CountDraft }) {
  const { t, i18n } = useTranslation();
  const number = (value: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 4 }).format(value);
  return <View style={{ gap: 12 }}>{draft.entries.map((entry) => {
    let counted: number | null = null;
    try { counted = inventoryQuantity(entry.raw, true); } catch { /* Blank is incomplete, never zero. */ }
    const delta = counted !== null && entry.expected !== null ? variance(counted, entry.expected) : null;
    return <Surface key={entry.batch.id} style={{ gap: 4 }}><BatchIdentity batch={entry.batch} /><Text>{t('inventoryReady.expected')}: {entry.expected === null ? t('inventoryReady.unavailable') : number(entry.expected)} · {t('inventory.counted')}: {counted === null ? t('inventoryReady.incomplete') : number(counted)}</Text><Text>{t('inventoryReady.difference')}: {delta === null ? '—' : new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 4, signDisplay: 'always' }).format(delta)} · {stockUnitLabel(entry.batch.stock_unit, t)}</Text></Surface>;
  })}</View>;
}
export function PhysicalCounts({ initialCountId, scope, organizationId, branchId, branchName, writable, canCount, online, onSaved }: Props) {
  const { t, i18n } = useTranslation(); const timezone = useBusinessTimezone();
  const store = useMemo(() => new InventoryFormStore(), []);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState<CountDraft | null>(null);
  const [history, setHistory] = useState<StockCount[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [resultLoaded, setResultLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const flight = useRef(false);
  const pointer = `active-count:${scope}`;
  const draftKey = useCallback((id: string) => `count:${scope}:${id}`, [scope]);
  useEffect(() => {
    const timer = setTimeout(() => {
      try { const id = store.get<string>(pointer); setDraft(id ? store.get<CountDraft>(draftKey(id)) : null); setReady(true); }
      catch (cause) { setError(t(inventoryErrorKey(cause))); }
    }, 0);
    return () => clearTimeout(timer);
  }, [draftKey, pointer, store, t]);
  const refreshHistory = useCallback(async () => {
    if (!online) return;
    setLoading(true);
    try { const result = await listStockCounts(organizationId, branchId, page); setHistory(result.items); setHasMore(result.hasMore); }
    finally { setLoading(false); }
  }, [branchId, online, organizationId, page]);
  useEffect(() => { let active = true; const timer = setTimeout(() => { void refreshHistory().catch((cause: unknown) => { if (active) setError(t(inventoryErrorKey(cause))); }); }, 0); return () => { active = false; clearTimeout(timer); }; }, [refreshHistory, t]);
  const persist = (value: CountDraft) => { store.set(draftKey(value.id), value); store.set(pointer, value.id); setDraft(value); };
  const run = async (action: () => Promise<void>) => {
    if (flight.current || !ready) return;
    flight.current = true; setBusy(true); setError(null); setMessage(null);
    try { await action(); } catch (cause) { setError(t(inventoryErrorKey(cause))); }
    finally { flight.current = false; setBusy(false); }
  };
  const open = async (id: string) => {
    const detail = await loadCountDetail(organizationId, branchId, id);
    const local = store.get<CountDraft>(draftKey(id));
    // Local raw entries include unfinished blanks; completed server records always win.
    const value: CountDraft = detail.count.status === 'OPEN' && local ? { ...local, entries: await Promise.all(local.entries.map(async (entry) => { const current = await loadInventoryBatch(organizationId, branchId, entry.batch.id); return { ...entry, expected: current.balance ? Number(current.balance.on_hand_quantity) : null }; })) } : { id, organizationId, branchId, createdAt: detail.count.created_at, entries: detail.entries, phase: detail.count.status === 'COMPLETED' ? 'completed' : detail.count.status === 'CANCELLED' ? 'cancelled' : 'editing' };
    persist(value); setMovements(detail.movements); setResultLoaded(detail.count.status === 'COMPLETED');
  };
  const start = () => run(async () => {
    if (!writable || !canCount) return;
    const value: CountDraft = { id: randomUUID(), organizationId, branchId, createdAt: new Date().toISOString(), entries: [], phase: 'editing' };
    persist(value); setMovements([]); setResultLoaded(false);
    await ensureStockCount(value); await refreshHistory();
  });
  const add = (batch: BatchChoice) => run(async () => {
    if (!draft || draft.entries.some((entry) => entry.batch.id === batch.id)) return;
    const current = await loadInventoryBatch(organizationId, branchId, batch.id);
    persist({ ...draft, entries: [...draft.entries, { batch: current.batch, raw: '', expected: current.balance ? Number(current.balance.on_hand_quantity) : null }] });
  });
  const save = async (review: boolean) => {
    if (!draft || !writable || !canCount) return;
    if (review) countValues(draft);
    // Unentered selected batches remain durable on this device; entered lines also save to the existing backend.
    const entered = { ...draft, entries: draft.entries.filter((entry) => entry.raw.trim() !== '') };
    if (entered.entries.length) await saveCountDraft(entered); else await ensureStockCount(draft);
    let value = draft;
    if (review) {
      const entries = await Promise.all(draft.entries.map(async (entry) => {
        const current = await loadInventoryBatch(organizationId, branchId, entry.batch.id);
        return { ...entry, expected: current.balance ? Number(current.balance.on_hand_quantity) : null };
      }));
      value = { ...draft, entries, phase: 'review' };
    }
    persist(value); setMessage(t('inventoryReady.draftSaved')); await refreshHistory();
  };
  const reconcile = () => run(async () => {
    if (!draft || !writable || !canCount || !['review', 'reconciling'].includes(draft.phase)) return;
    const pending: CountDraft = { ...draft, phase: 'reconciling' };
    persist(pending);
    try { await reconcileInventoryCount(pending); }
    catch (cause) {
      if (isDefinitiveRejection(cause)) persist({ ...pending, phase: 'review' });
      throw cause;
    }
    // Persist acceptance before fetching details, so a refresh failure cannot suggest a new count.
    persist({ ...pending, phase: 'completed' });
    await open(pending.id); await onSaved(); await refreshHistory();
  });
  const completed = draft?.phase === 'completed';
  const cancelled = draft?.phase === 'cancelled';
  const editing = draft?.phase === 'editing';
  const locked = busy || !writable || !canCount || !ready;
  return <Surface style={{ gap: 12 }}>{initialCountId ? <Button variant="secondary" disabled={!online || !ready || busy} label={t('notificationsReady.countLink', { id: initialCountId })} onPress={() => void run(() => open(initialCountId))} /> : null}<Text style={{ fontWeight: '800', fontSize: 20 }}>{t('inventory.stockCount')}</Text><Text>{t('organization.branch')}: {branchName}</Text><Text>{t('inventoryReady.countScope')}</Text><Text>{t('inventoryReady.branchBound')}</Text>
    {error ? <Alert tone="danger" title={error} /> : null}{message ? <Alert tone="info" title={message} /> : null}
    {!draft || completed || cancelled ? <Button disabled={locked} label={t('inventoryReady.createCount')} onPress={() => void start()} /> : null}
    {draft ? <>
      <Text selectable>{t('inventoryReady.countReference')}: {draft.id}</Text><Text>{t('inventoryReady.timestamp')}: {formatInstantDateTime(draft.createdAt, i18n.language, timezone)}</Text><Text>{t('inventoryReady.status')}: {t(completed ? 'inventoryReady.completed' : cancelled ? 'inventoryReady.cancelled' : 'inventoryReady.open')}</Text>
      {!completed && !cancelled ? <Text>{t('inventoryReady.localDraft')}</Text> : null}
      {editing ? <>
        <CatalogSelector scope={`count:${scope}:${draft.id}`} label={t('inventoryReady.addBatch')} disabled={locked} load={(query, index) => searchBatches(organizationId, branchId, query, index)} renderLabel={(item) => `${item.product_name} · ${item.lot_number} · ${stockUnitLabel(item.stock_unit, t)}`} onSelect={(batch) => void add(batch)} />
        {draft.entries.map((entry) => <Surface key={entry.batch.id} style={{ gap: 8 }}><BatchIdentity batch={entry.batch} /><Text>{t('inventoryReady.expected')}: {entry.expected === null ? t('inventoryReady.unavailable') : Number(entry.expected).toLocaleString(i18n.language, { maximumFractionDigits: 4 })}</Text><FormField label={t('inventory.counted')}><TextField accessibilityLabel={`${t('inventory.counted')} ${entry.batch.lot_number}`} editable={!locked} keyboardType="decimal-pad" value={entry.raw} onChangeText={(raw) => { try { persist({ ...draft, entries: draft.entries.map((item) => item.batch.id === entry.batch.id ? { ...item, raw } : item) }); } catch (cause) { setError(t(inventoryErrorKey(cause))); } }} /></FormField></Surface>)}
        <Button disabled={locked} label={t('inventoryReady.saveDraft')} onPress={() => void run(() => save(false))} /><Button disabled={locked} label={t('inventoryReady.review')} onPress={() => void run(() => save(true))} />
      </> : <>
        <CountVariance draft={draft} />
        {cancelled ? <Text>{t('inventoryReady.notOpen')}</Text> : completed ? <><Alert tone="info" title={t('inventoryReady.countAccepted')} />{!resultLoaded ? <Text>{t('inventoryReady.detailRetry')}</Text> : movements.length === 0 ? <Text>{t('inventoryReady.noMovements')}</Text> : null}{movements.map((movement) => <MovementDetail key={movement.id} movement={movement} batch={draft.entries.find((entry) => entry.batch.id === movement.batch_id)?.batch} />)}</> : <>
          <Alert tone="warning" title={t(draft.phase === 'reconciling' ? 'inventoryReady.reconcileUncertain' : 'inventoryReady.confirmReconcile')} />
          <Button disabled={locked} label={t(draft.phase === 'reconciling' ? 'inventoryReady.recoverCount' : 'inventoryReady.confirmPost')} onPress={() => void reconcile()} />
          {draft.phase === 'review' ? <Button disabled={locked} variant="secondary" label={t('inventoryReady.editCount')} onPress={() => { try { persist({ ...draft, phase: 'editing' }); } catch (cause) { setError(t(inventoryErrorKey(cause))); } }} /> : null}
        </>}
      </>}
      <Button variant="secondary" disabled={busy || !online} label={t('inventoryReady.reloadCount')} onPress={() => void run(async () => { await open(draft.id); })} />
    </> : null}
    <Text style={{ fontWeight: '800' }}>{t('inventoryReady.history')}</Text>{loading ? <Text>{t('common.loading')}</Text> : null}{!loading && !history.length ? <Text>{t('inventoryReady.noCounts')}</Text> : null}
    {history.map((count) => <Button key={count.id} disabled={busy || !online} variant="secondary" label={`${t(count.status === 'COMPLETED' ? 'inventoryReady.completed' : count.status === 'CANCELLED' ? 'inventoryReady.cancelled' : 'inventoryReady.open')} · ${formatInstantDateTime(count.created_at, i18n.language, timezone)} · ${count.id}`} onPress={() => void run(async () => { await open(count.id); })} />)}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button disabled={busy || !online || page === 0} label={t('catalogReady.previous')} variant="ghost" onPress={() => setPage((value) => value - 1)} /><Text>{t('catalogReady.page', { page: page + 1 })}</Text><Button disabled={busy || !online || !hasMore} label={t('catalogReady.next')} variant="ghost" onPress={() => setPage((value) => value + 1)} /></View>
  </Surface>;
}
