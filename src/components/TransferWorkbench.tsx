import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { Text, View } from 'react-native';
import { useTranslation } from '../i18n/useTranslation';
import { Alert, Button, FormField, Surface, TextField } from './ui';
import { TransferDetails, transferErrorKey } from './TransferDetails';
import { TransferRequest } from './TransferRequest';
import { InventoryFormStore } from '../domain/inventoryCompletion';
import { receiptValues, transferActionInBranch, transferDifference, transferEligibleQuantity, type TransferOperation } from '../domain/transferCompletion';
import type { TransferAction } from '../domain/transferSafety';
import { isDefinitiveRejection, parseLocaleNumber } from '../domain/numericInput';
import { stockUnitLabel } from '../domain/stockUnits';
import { LocalStore } from '../offline/localStore';
import { loadTransferDetail, submitTransferOperation, type TransferDetail } from '../services/transferCompletion';

type Props = { scope: string; organizationId: string; branchId: string; branches: { id: string; name: string; status: string }[]; selectedId: string | null; online: boolean; writable: boolean; manageBranches: boolean; can: (permission: string) => boolean; onSaved: (id?: string) => void };
export function TransferWorkbench({ scope, organizationId, branchId, branches, selectedId, online, writable, manageBranches, can, onSaved }: Props) {
  const { t, i18n } = useTranslation();
  const store = useMemo(() => new InventoryFormStore(), []);
  const replica = useMemo(() => new LocalStore(), []);
  const key = `transfer:${scope}`;
  const [ready, setReady] = useState(false);
  const [operation, setOperation] = useState<TransferOperation | null>(null);
  const [review, setReview] = useState<TransferOperation | null>(null);
  const [detail, setDetail] = useState<TransferDetail | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cached, setCached] = useState(false);
  const flight = useRef(false);
  const generation = useRef(0);
  const translate = useRef(t);
  useEffect(() => { translate.current = t; }, [t]);
  useEffect(() => { const timer = setTimeout(() => { try { setOperation(store.get<TransferOperation>(key)); setReady(true); } catch (cause) { setError(translate.current(transferErrorKey(cause))); } }, 0); return () => clearTimeout(timer); }, [key, store]);
  const inspect = useCallback(async (id: string) => {
    const ticket = ++generation.current;
    setError(null); setDetail(null); setReview(null); setQuantities({}); setReasons({}); setNotes('');
    const cacheKey = `transfer:detail:${scope}:${id}`;
    const saved = replica.get<TransferDetail>(cacheKey);
    if (saved) { setDetail(saved.data); setCached(true); }
    if (!online) { setBusy(false); return; }
    setBusy(true);
    try {
      const next = await loadTransferDetail(organizationId, id);
      if (ticket !== generation.current) return;
      replica.set(cacheKey, { data: next, syncedAt: new Date().toISOString() });
      setDetail(next); setCached(false);
      setQuantities(Object.fromEntries(next.lines.map((line) => [line.id, String(line.dispatched_quantity)])));
    } catch (cause) { if (ticket === generation.current) { setCached(true); setError(translate.current(transferErrorKey(cause))); } }
    finally { if (ticket === generation.current) setBusy(false); }
  }, [online, organizationId, replica, scope]);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const detailId = operation?.resultId || (operation ? null : selectedId);
  useEffect(() => { const timer = setTimeout(() => { if (ready && detailId) void inspect(detailId); else { setDetail(null); setCached(false); setBusy(flight.current); setReview(null); } }, 0); return () => { clearTimeout(timer); invalidate(); }; }, [detailId, ready, inspect, invalidate]);
  const persist = (value: TransferOperation) => { store.set(key, value); setOperation(value); };
  const permission = (action: TransferOperation['action']) => can(action === 'request' || action === 'cancel' ? 'transfer.create' : `transfer.${action}`);
  const run = async () => {
    let saved = operation || review;
    if (!saved || !ready || flight.current || !writable || !permission(saved.action)) return;
    flight.current = true; setBusy(true); setError(null);
    try {
      if (!operation) persist(saved);
      const id = await submitTransferOperation(saved, organizationId, branchId, () => { saved = { ...saved!, phase: 'dispatched' }; persist(saved); });
      saved = { ...saved, resultId: id, rejected: false }; persist(saved); setReview(null);
      await inspect(id); onSaved(id);
    } catch (cause) {
      if (saved && cause instanceof Error && cause.message === 'TRANSFER_RECEIPT_CHANGED' && 'transferId' in cause) {
        saved = { ...saved, resultId: String(cause.transferId), outcomeMismatch: true }; persist(saved);
        await inspect(saved.resultId!); onSaved(saved.resultId);
      }
      const local = cause instanceof Error && /^(TRANSFER_(SOURCE_BATCH_INVALID|SOURCE_BATCH_NOT_ELIGIBLE|SAME_BRANCH|STATE_CHANGED|LINES_REQUIRED)|INVENTORY_QUANTITY_INVALID|INSUFFICIENT_STOCK)$/.test(cause.message);
      const invalidReference = cause && typeof cause === 'object' && 'code' in cause && cause.code === '23503';
      if (saved && !saved.resultId && (isDefinitiveRejection(cause) || invalidReference || local)) persist({ ...saved, rejected: true });
      setError(t(transferErrorKey(cause)));
    } finally { flight.current = false; setBusy(false); }
  };
  const prepare = (action: TransferAction) => {
    if (!detail || cached || !transferActionInBranch(detail.transfer, action, branchId, manageBranches)) return;
    setError(null);
    try {
      const transfer = detail.transfer;
      setReview({ organizationId, branchId, sourceBranchId: transfer.source_branch_id, destinationBranchId: transfer.destination_branch_id, transferId: transfer.id, transferNumber: transfer.transfer_number, action, key: randomUUID(), createdAt: new Date().toISOString(), phase: 'prepared', notes, sourceName: detail.branches.find((row) => row.id === transfer.source_branch_id)?.name, destinationName: detail.branches.find((row) => row.id === transfer.destination_branch_id)?.name, receivedLines: action === 'receive' ? receiptValues(detail.lines, quantities, reasons) : undefined, labels: detail.lines.map((line) => ({ product: detail.products.find((row) => row.id === line.product_id)?.name || t('transferReady.unavailable'), lot: detail.batches.find((row) => row.id === line.source_batch_id)?.lot_number || t('transferReady.unavailable'), unit: detail.products.find((row) => row.id === line.product_id)?.stock_unit, quantity: Number(line.requested_quantity) })) });
    } catch (cause) { setError(t(transferErrorKey(cause))); }
  };
  const finish = () => {
    if (!operation || (!operation.resultId && !operation.rejected)) return;
    try { store.set(`transfer-history:${scope}:${operation.key}`, operation); store.remove(key); setOperation(null); setReview(null); setError(null); onSaved(operation.resultId); }
    catch (cause) { setError(t(transferErrorKey(cause))); }
  };
  const disabled = !ready || !writable || busy || Boolean(operation) || Boolean(review);
  const current = operation || review;
  const number = (value: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 4 }).format(value);
  const name = (id: string) => detail?.branches.find((row) => row.id === id)?.name || branches.find((row) => row.id === id)?.name || (current?.sourceBranchId === id ? current.sourceName : current?.destinationName) || t('transferReady.unavailable');
  return <View style={{ gap: 16 }}>
    {error ? <Alert tone="danger" title={error} /> : null}
    {operation?.outcomeMismatch ? <Alert tone="warning" title={t('transferReady.errors.TRANSFER_RECEIPT_CHANGED')} /> : null}
    {current ? <Surface style={{ gap: 10 }}>
      <Text style={{ fontWeight: '800' }}>{t(operation ? operation.resultId ? 'transferReady.accepted' : operation.rejected ? 'transferReady.rejected' : 'transferReady.retained' : 'transferReady.confirm')}</Text>
      <Text>{current.transferNumber}</Text><Text>{t('transferReady.route', { source: name(current.sourceBranchId), destination: name(current.destinationBranchId) })}</Text>
      <Text>{t(`transferReady.actions.${current.action}`)}</Text>
      {current.labels?.map((line, index) => <Text key={index}>{line.product} · {line.lot} · {number(line.quantity)} {stockUnitLabel(line.unit, t)}</Text>)}
      <Text>{t(`transferReady.effects.${current.action}`)}</Text><Text>{current.notes || '—'}</Text><Text selectable>{t('transferReady.operation')}: {current.key}</Text>
      {current.receivedLines?.map((line) => { const item = detail?.lines.find((row) => row.id === line.line_id); const batch = detail?.batches.find((row) => row.id === item?.source_batch_id); const product = detail?.products.find((row) => row.id === item?.product_id); return <Text key={line.line_id}>{product?.name} · {batch?.lot_number} · {t('transferReady.received')}: {number(line.quantity)} · {t('transferReady.difference')}: {item ? number(transferDifference(Number(item.dispatched_quantity), line.quantity)) : '—'} · {line.reason || '—'}</Text>; })}
      {!operation ? <><Button label={t('transferReady.confirm')} disabled={!writable || busy} onPress={() => void run()} /><Button variant="ghost" label={t('transferReady.backToEdit')} disabled={busy} onPress={() => setReview(null)} /></> : operation.resultId || operation.rejected ? <><Text selectable>{t('transferReady.reference')}: {operation.resultId || '—'}</Text>{operation.resultId ? <Button label={t('transferReady.refreshDetail')} disabled={!online || busy} onPress={() => void inspect(operation.resultId!).then(() => onSaved(operation.resultId))} /> : null}<Button label={t('transferReady.continue')} disabled={busy} onPress={finish} /></> : <><Text>{t('transferReady.recoveryHint')}</Text><Button label={t('transferReady.recover')} disabled={!writable || busy || !permission(operation.action)} onPress={() => void run()} /></>}
    </Surface> : null}
    {busy ? <Text>{t('common.loading')}</Text> : null}
    {detail ? <Surface style={{ gap: 12 }}>
      {cached ? <Text>{t('transferReady.cached')}</Text> : null}
      <TransferDetails detail={detail} branches={branches} />
      {detail.transfer.status === 'REQUESTED' || detail.transfer.status === 'APPROVED' ? <Text>{t('transferReady.fullApproval')}</Text> : null}
      {detail.lines.map((line) => { const product = detail.products.find((row) => row.id === line.product_id); const batch = detail.batches.find((row) => row.id === line.source_batch_id); const balance = detail.balances.find((row) => row.batch_id === line.source_batch_id); return <View key={line.id} style={{ gap: 8 }}><Text>{product?.name} · {batch?.lot_number} · {t('transferReady.eligible')}: {transferEligibleQuantity(batch, balance) === null ? '—' : number(transferEligibleQuantity(batch, balance)!)}</Text>{detail.transfer.status === 'DISPATCHED' && can('transfer.receive') ? <><FormField label={t('transferReady.received')}><TextField accessibilityLabel={`${t('transferReady.received')} ${batch?.lot_number}`} editable={!disabled && !cached} keyboardType="decimal-pad" value={quantities[line.id] ?? ''} onChangeText={(raw) => setQuantities((current) => ({ ...current, [line.id]: raw }))} /></FormField><Text>{t('transferReady.expected')}: {number(Number(line.dispatched_quantity))} · {t('transferReady.difference')}: {parseLocaleNumber(quantities[line.id] ?? '') === null ? '—' : number(transferDifference(Number(line.dispatched_quantity), parseLocaleNumber(quantities[line.id] ?? '')!))}</Text><FormField label={t('transferReady.reason')}><TextField accessibilityLabel={`${t('transferReady.reason')} ${batch?.lot_number}`} editable={!disabled && !cached} value={reasons[line.id] ?? ''} onChangeText={(raw) => setReasons((current) => ({ ...current, [line.id]: raw }))} /></FormField></> : null}</View>; })}
      {['REQUESTED', 'APPROVED', 'DISPATCHED'].includes(detail.transfer.status) ? <FormField label={t('transferReady.actionNotes')}><TextField accessibilityLabel={t('transferReady.actionNotes')} editable={!disabled && !cached} value={notes} onChangeText={setNotes} /></FormField> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(['approve', 'dispatch', 'receive', 'cancel'] as const).filter((action) => permission(action) && transferActionInBranch(detail.transfer, action, branchId, manageBranches)).map((action) => <Button key={action} variant={action === 'cancel' ? 'secondary' : 'primary'} label={t(`transferReady.actions.${action}`)} disabled={disabled || cached} onPress={() => prepare(action)} />)}</View>
      <Button variant="ghost" label={t('transferReady.refreshDetail')} disabled={!online || busy || Boolean(review)} onPress={() => void inspect(detail.transfer.id)} />
    </Surface> : selectedId && !busy && !operation ? <Button label={t('transferReady.refreshDetail')} disabled={!online} onPress={() => void inspect(selectedId)} /> : null}
    {can('transfer.create') && !operation && !selectedId ? <TransferRequest organizationId={organizationId} branchId={branchId} branches={branches} disabled={disabled} onReview={setReview} /> : null}
  </View>;
}
