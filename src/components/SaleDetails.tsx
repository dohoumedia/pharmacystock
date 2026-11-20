import { useEffect, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useTranslation } from '../i18n/useTranslation';
import { Alert, Button, FormField, Stack, Surface, TextField } from './ui';
import { Receipt, type ReceiptContext } from './Receipt';
import { printReceipt } from '../utils/printReceipt';
import { saleDetail, refundByIdentity, type SaleDetailData } from '../services/posCompletion';
import { refundSale } from '../services/sales';
import { refundableQuantity, refundSelection } from '../domain/posCompletion';
import { isDefinitiveRejection } from '../domain/numericInput';
import { formatPosCurrency, formatPosDate, posStatusTranslationKey } from '../utils/posPresentation';
import { createPosAttemptStore } from '../services/posAttempts';
import { errorPresentationKey } from '../utils/errorPresentation';
import { spacing } from '../theme/tokens';

type RefundAttempt = Parameters<typeof refundSale>[0];
const store = createPosAttemptStore();
export function SaleDetails({ organizationId, branchId, saleId, userId, business, branchName, footer, timezone, address, contact, canRefund, online, onClose, onChanged }: { organizationId: string; branchId: string; saleId: string; userId: string; business: string; branchName: string; footer?: string | null; canRefund: boolean; online: boolean; onClose: () => void; onChanged: () => void } & ReceiptContext) {
  const { t, i18n } = useTranslation();
  const key = `pos:refund:${userId}:${organizationId}:${branchId}:${saleId}`;
  const [detail, setDetail] = useState<SaleDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(''); const [quantity, setQuantity] = useState(''); const [reason, setReason] = useState('');
  const [review, setReview] = useState<RefundAttempt | null>(null);
  const [pending, setPending] = useState<RefundAttempt | null>(() => store.read<RefundAttempt>(key));
  const [busy, setBusy] = useState(false); const inFlight = useRef(false);
  const [error, setError] = useState(''); const [result, setResult] = useState('');
  const receipt = useRef<View>(null);
  const refresh = async () => { const fresh = await saleDetail(organizationId, branchId, saleId); setDetail(fresh); return fresh; };
  useEffect(() => { let active = true; if (online) void saleDetail(organizationId, branchId, saleId).then(value => { if (active) setDetail(value); }).catch(() => { if (active) setError(t('posReady.detailError')); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [organizationId, branchId, saleId, online, t]);
  const prepare = async () => {
    if (inFlight.current || !online || pending) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const fresh = await refresh();
      const item = fresh.items.find(i => i.id === selected);
      const selection = refundSelection(item, quantity, fresh.refundItems);
      if (!selection || !reason.trim()) { setError(t('posReady.refundInvalid')); return; }
      const uuid = randomUUID(); setReview({ saleId, refundNumber: `REF-${uuid}`, idempotencyKey: `refund:${saleId}:${uuid}`, items: [{ sale_item_id: selection.sale_item_id, quantity: selection.quantity }], reason: reason.trim() });
    } catch (cause) { setError(t(errorPresentationKey(cause))); } finally { inFlight.current = false; setBusy(false); }
  };
  const submit = async () => {
    const attempt = pending ?? review;
    if (!attempt || inFlight.current || !online) return;
    inFlight.current = true; setBusy(true); setError('');
    let commandRejected = false; let persisted = !!pending;
    try {
      // Persistence must succeed before dispatch. Recovery always checks accepted identity first.
      store.save(key, attempt); persisted = true; setPending(attempt); setReview(null);
      const accepted = await refundByIdentity(organizationId, saleId, attempt.idempotencyKey);
      if (!accepted) { try { await refundSale(attempt); } catch (cause) { commandRejected = isDefinitiveRejection(cause); throw cause; } }
      const fresh = await refresh();
      const recorded = fresh.refunds.find(r => r.refund_number === attempt.refundNumber);
      setResult(t('posReady.refundSuccess', { reference: recorded?.refund_number ?? attempt.refundNumber }));
      store.remove(key); setPending(null); setSelected(''); setQuantity(''); setReason(''); onChanged();
    } catch {
      if (commandRejected) { store.remove(key); setPending(null); setError(t('posReady.refundChanged')); try { await refresh(); } catch { /* keep rejection visible */ } }
      else setError(t(persisted ? 'posReady.refundRecovery' : 'posReady.storageUnavailable'));
    } finally { inFlight.current = false; setBusy(false); }
  };
  const selectedItem = detail?.items.find(i => i.id === selected);
  const selection = refundSelection(selectedItem, quantity, detail?.refundItems ?? []);
  const money = (n: number) => formatPosCurrency(Number(n), detail?.sale.currency_code ?? 'XOF', i18n.language);
  return <Surface tone="raised"><Stack gap={spacing.md}>
    <Button label={t('posReady.close')} variant="secondary" onPress={onClose} disabled={busy} />
    {!online ? <Alert tone="warning" title={t('posReady.offline')} /> : null}
    {error ? <Alert tone="danger" title={error} /> : null}{result ? <Alert tone="success" title={result} /> : null}
    {!detail ? <>{online && loading ? <Text>{t('posReady.loading')}</Text> : null}<Button label={t('posReady.refresh')} onPress={() => { void refresh().catch(() => setError(t('posReady.detailError'))); }} disabled={!online || loading} /></> : <>
      <View ref={receipt} collapsable={false}><Receipt detail={detail} business={business} branch={branchName} footer={footer} timezone={timezone} address={address} contact={contact} /></View>
      {Platform.OS === 'web' ? <Button label={t('posReady.print')} variant="secondary" onPress={() => { if (!printReceipt(receipt)) setError(t('posReady.printUnavailable')); }} /> : null}
      <Text accessibilityRole="header">{t('posReady.refundHistory')}</Text>
      {detail.refunds.length === 0 ? <Text>{t('posReady.noRefunds')}</Text> : detail.refunds.map(refund => <View key={refund.id} style={{ gap: 4 }}><Text>{refund.refund_number} · {formatPosDate(refund.created_at, i18n.language, timezone)} · {money(refund.amount)} · {refund.reason}</Text>{detail.refundItems.filter(r => r.refund_id === refund.id).map(r => { const item = detail.items.find(i => i.id === r.sale_item_id); return <View key={r.id}><Text>{detail.products.find(p => p.id === item?.product_id)?.name ?? item?.product_id} · {detail.batches.find(b => b.id === r.batch_id)?.lot_number ?? r.batch_id} · {Number(r.quantity).toLocaleString(i18n.language)} · {money(r.amount)}</Text><Text>{t('posReady.movement', { reference: r.inventory_movement_id ?? '—' })}</Text></View>; })}</View>)}
      <Text>{t('posReady.status')}: {t(posStatusTranslationKey(detail.sale.status))}</Text>
      {canRefund && detail.sale.status !== 'VOIDED' ? <>
        <Text>{t('posReady.multiBatch')}</Text><Text>{t('posReady.refundEffect')}</Text>
        {pending ? <><Alert tone="warning" title={t('posReady.refundRecovery')} /><Text>{pending.refundNumber} · {pending.reason} · {pending.items[0]?.quantity}</Text><Button label={t('posReady.refundRetry')} disabled={!online || busy} loading={busy} onPress={() => void submit()} /></> : <>
          {detail.items.map(item => { const remaining = refundableQuantity(item, detail.refundItems); return <View key={item.id} style={{ gap: spacing.sm }}><Text>{detail.products.find(p => p.id === item.product_id)?.name ?? item.product_id} · {detail.batches.find(b => b.id === item.batch_id)?.lot_number ?? item.batch_id}</Text><Text>{t('posReady.sold')}: {Number(item.quantity).toLocaleString(i18n.language)} · {t('posReady.refunded')}: {Number(Number(item.quantity) - remaining).toLocaleString(i18n.language)} · {t('posReady.remaining')}: {remaining.toLocaleString(i18n.language)}</Text><Button label={t(selected === item.id ? 'posReady.selectedLine' : 'posReady.selectLine')} variant={selected === item.id ? 'primary' : 'secondary'} disabled={busy || !!review || !online || remaining <= 0} onPress={() => { setSelected(item.id); setQuantity(''); setResult(''); }} /></View>; })}
          <FormField label={t('posReady.requested')}><TextField accessibilityLabel={t('posReady.requested')} value={quantity} editable={!busy && !review} onChangeText={setQuantity} keyboardType="decimal-pad" /></FormField>
          <FormField label={t('posReady.reason')}><TextField accessibilityLabel={t('posReady.reason')} value={reason} editable={!busy && !review} onChangeText={setReason} /></FormField>
          {selection ? <Text>{t('posReady.refundAmount')}: {money(selection.amount)}</Text> : null}
          {review ? <><Text>{review.refundNumber} · {review.items[0]?.quantity} · {money(selection?.amount ?? 0)} · {review.reason}</Text><Button label={t('posReady.refundConfirm')} disabled={busy || !online} onPress={() => void submit()} /><Button label={t('posReady.cancel')} variant="secondary" onPress={() => setReview(null)} /></> : <Button label={t('posReady.refundReview')} disabled={!selection || !reason.trim() || busy || !online} loading={busy} onPress={() => void prepare()} />}
        </>}
      </> : null}
    </>}
  </Stack></Surface>;
}
