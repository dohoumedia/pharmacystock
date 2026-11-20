import { useEffect, useMemo, useRef, useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { Text, View } from 'react-native';
import { useTranslation } from '../i18n/useTranslation';
import { CatalogSelector } from './CatalogSelector';
import { Alert, Button, FormField, Surface, TextField } from './ui';
import { searchBatches, type BatchChoice } from '@/services/catalogReadiness';
import { findInventoryMovement, loadInventoryBatch, submitInventoryAdjustment } from '@/services/inventoryCompletion';
import type { InventoryBalance, InventoryMovement } from '@/services/inventory';
import { adjustmentValues, InventoryFormStore, variance, type AdjustmentRequest } from '../domain/inventoryCompletion';
import { inventoryQuantity } from '../domain/inventoryCompletion';
import { isDefinitiveRejection } from '../domain/numericInput';
import { stockUnitLabel } from '../domain/stockUnits';
import { isBatchSellable } from '../domain/inventorySafety';
import { PhysicalCounts } from './PhysicalCounts';

import { AdjustmentConfirmation, BatchIdentity, inventoryErrorKey } from './InventoryResultDetails';

type Props = { initialCountId?: string; scope: string; organizationId: string; branchId: string; branchName: string; writable: boolean; canAdjust: boolean; canCount: boolean; online: boolean; onSaved: () => Promise<void> };
export function InventoryWorkbench(props: Props) {
  return <View style={{ gap: 20 }}><Adjustments {...props} /><PhysicalCounts {...props} /></View>;
}
function Adjustments({ scope, organizationId, branchId, branchName, writable, canAdjust, online, onSaved }: Props) {
  const { t, i18n } = useTranslation();
  const store = useMemo(() => new InventoryFormStore(), []);
  const [ready, setReady] = useState(false);
  const [batch, setBatch] = useState<BatchChoice | null>(null);
  const [balance, setBalance] = useState<InventoryBalance | null>(null);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [direction, setDirection] = useState<'IN' | 'OUT'>('OUT');
  const [request, setRequest] = useState<AdjustmentRequest | null>(null);
  const [movement, setMovement] = useState<InventoryMovement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flight = useRef(false);
  const selection = useRef(0);
  const key = `adjustment:${scope}`;
  useEffect(() => { const timer = setTimeout(() => { try { setRequest(store.get<AdjustmentRequest>(key)); setReady(true); } catch (cause) { setError(t(inventoryErrorKey(cause))); } }, 0); return () => clearTimeout(timer); }, [key, store, t]);
  const persist = (value: AdjustmentRequest) => { store.set(key, value); setRequest(value); };
  const inspect = async (value: AdjustmentRequest) => {
    const found = await findInventoryMovement(organizationId, branchId, value.idempotencyKey);
    if (found) { setMovement(found); const current = await loadInventoryBatch(organizationId, branchId, value.batch.id); setBalance(current.balance); }
  };
  const select = async (value: BatchChoice) => {
    const ticket = ++selection.current;
    setBatch(value); setBalance(null); setError(null);
    try { const current = await loadInventoryBatch(organizationId, branchId, value.id); if (ticket === selection.current) { setBatch(current.batch); setBalance(current.balance); } }
    catch (cause) { if (ticket === selection.current) setError(t(inventoryErrorKey(cause))); }
  };
  const submit = async () => {
    if (flight.current || !ready || !writable || !canAdjust) return;
    flight.current = true; setBusy(true); setError(null);
    let operation = request;
    try {
      if (!operation) {
        const delta = adjustmentValues(quantity, direction, reason, batch, balance, organizationId, branchId);
        operation = { organizationId, branchId, batch: batch!, quantityDelta: delta, reason: reason.trim(), reference: reference.trim(), idempotencyKey: `adjustment:${randomUUID()}`, occurredAt: new Date().toISOString(), observedOnHand: Number(balance!.on_hand_quantity) };
        persist(operation); // Durable before the first network request.
      }
      const id = await submitInventoryAdjustment(operation, organizationId, branchId);
      const accepted = { ...operation, resultId: id, rejected: false };
      persist(accepted);
      operation = accepted;
      await inspect(accepted); await onSaved();
    } catch (cause) {
      if (operation && !operation.resultId && (isDefinitiveRejection(cause) || (cause instanceof Error && /INVENTORY_(QUANTITY_INVALID|BATCH_INVALID|REASON_REQUIRED|BATCH_STATUS_BLOCKS_INBOUND)|INSUFFICIENT_STOCK/.test(cause.message)))) persist({ ...operation, rejected: true });
      setError(t(inventoryErrorKey(cause)));
    } finally { flight.current = false; setBusy(false); }
  };
  let preview: number | null = null;
  try { if (balance) preview = variance(Number(balance.on_hand_quantity), -(direction === 'IN' ? 1 : -1) * inventoryQuantity(quantity)); } catch { /* Incomplete input has no preview. */ }
  if (!canAdjust && !request) return null;
  const locked = busy || !writable || !ready || Boolean(request);
  return <Surface style={{ gap: 12 }}><Text style={{ fontWeight: '800', fontSize: 20 }}>{t('inventory.adjustment')}</Text><Text>{t('organization.branch')}: {branchName}</Text><Text>{t('inventoryReady.branchBound')}</Text>
    {error ? <Alert tone="danger" title={error} /> : null}
    {request ? <>
      {request.resultId ? <AdjustmentConfirmation request={request} movement={movement} balance={balance} /> : <><BatchIdentity batch={request.batch} /><Text>{t(request.rejected ? 'inventoryReady.rejected' : 'inventoryReady.uncertain')}</Text><Text>{t('inventoryReady.reference')}: {request.idempotencyKey}</Text><Text>{t('inventory.quantity')}: {request.quantityDelta} · {request.reason}</Text></>}
      {!request.resultId && !request.rejected ? <Button disabled={busy || !writable || !canAdjust} label={t('inventoryReady.retryExact')} onPress={() => void submit()} /> : null}
      {request.resultId ? <Button disabled={!online || busy} variant="secondary" label={t('inventoryReady.refreshResult')} onPress={() => { void inspect(request).catch((cause: unknown) => setError(t(inventoryErrorKey(cause)))); }} /> : null}
      {request.resultId || request.rejected ? <Button disabled={busy} label={t(request.rejected ? 'inventoryReady.correct' : 'inventoryReady.newAdjustment')} onPress={() => { try { store.set(`adjustment-history:${scope}:${request.idempotencyKey}`, request); store.remove(key); setRequest(null); setMovement(null); setBalance(null); setBatch(null); setQuantity(''); setReason(''); setReference(''); setError(null); } catch (cause) { setError(t(inventoryErrorKey(cause))); } }} /> : null}
    </> : <>
      <CatalogSelector scope={scope} label={t('catalogReady.searchBatch')} disabled={locked} load={(query, page) => searchBatches(organizationId, branchId, query, page)} renderLabel={(item) => `${item.product_name} · ${item.lot_number} · ${stockUnitLabel(item.stock_unit, t)}`} onSelect={(value) => void select(value)} selectedLabel={batch ? `${batch.product_name} · ${batch.lot_number}` : undefined} />
      {batch ? <BatchIdentity batch={batch} /> : null}
      <Text>{t('inventory.onHand')}: {balance ? new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 4 }).format(Number(balance.on_hand_quantity)) : t('inventoryReady.unavailable')} · {t('production.inventoryView.reserved')}: {balance ? Number(balance.reserved_quantity).toLocaleString(i18n.language) : '—'} · {t('production.inventoryView.available')}: {batch && !isBatchSellable(batch.status, batch.expiry_date) ? t('production.inventoryView.notSellable') : balance ? Number(balance.available_quantity).toLocaleString(i18n.language) : '—'}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(['OUT', 'IN'] as const).map((value) => <Button key={value} disabled={locked} variant={direction === value ? 'primary' : 'secondary'} label={t(value === 'IN' ? 'inventory.increase' : 'inventory.decrease')} onPress={() => setDirection(value)} />)}</View>
      <FormField label={t('inventory.quantity')}><TextField accessibilityLabel={t('inventory.quantity')} keyboardType="decimal-pad" editable={!locked} value={quantity} onChangeText={setQuantity} /></FormField>
      <FormField label={t('inventory.reason')} required><TextField accessibilityLabel={t('inventory.reason')} editable={!locked} value={reason} onChangeText={setReason} /></FormField>
      <FormField label={t('inventoryReady.reference')}><TextField accessibilityLabel={t('inventoryReady.reference')} editable={!locked} value={reference} onChangeText={setReference} /></FormField>
      {preview !== null ? <Text>{t('inventoryReady.previewResult')}: {new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 4 }).format(preview)}</Text> : null}
      <Button label={t('inventory.postAdjustment')} disabled={locked || !canAdjust} loading={busy} onPress={() => void submit()} />
    </>}
  </Surface>;
}
