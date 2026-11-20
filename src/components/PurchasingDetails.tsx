import { formatCurrency } from '../domain/operationsPresentation';
import { useBusinessTimezone } from '../hooks/useBusinessTimezone';
import { useEffect, useState } from 'react';
import { Link } from 'expo-router';
import { Text, View } from 'react-native';
import { useTranslation } from '../i18n/useTranslation';
import { Alert, Button, StatusBadge, Surface, TextField } from './ui';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { loadBatchProvenance, loadReceiptDetail, searchReceipts, type OrderDetail, type ReceiptDetail } from '@/services/purchasingDetails';
import type { PurchaseReceipt, Supplier } from '@/services/purchasing';
import { remainingQuantity } from '../domain/purchasingReadiness';
import { stockUnitLabel } from '../domain/stockUnits';
import { formatDateOnly, formatInstantDateTime } from '../utils/dateFormatting';

export function OrderSummary({ detail, branchName, onReceipt, onSupplier, readOnly = false }: { readOnly?: boolean; detail: OrderDetail; branchName: string; onReceipt: (id: string) => void; onSupplier: (supplier: Supplier) => void }) {
  const { t, i18n } = useTranslation(); const timezone = useBusinessTimezone();
 const { order, supplier, lines, receipts } = detail;
  const quantity = (n: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 3 }).format(Number(n));
  return <Surface style={{ gap: 12 }}>
    <Text accessibilityRole="header">{t('purchaseReady.orderDetail')}: {order.po_number}</Text>
    <Button variant="secondary" label={`${t('purchasing.supplier')}: ${supplier.name}`} onPress={() => onSupplier(supplier)} />
    <Text>{t('organization.branch')}: {branchName}</Text><Text>{t('purchaseReady.created')}: {formatInstantDateTime(order.created_at, i18n.language, timezone)}</Text>
    <StatusBadge label={t(`purchasing.status.${order.status}`)} tone={order.status === 'cancelled' ? 'danger' : order.status === 'received' ? 'success' : 'info'} />
    {lines.map((line) => <Surface tone="inset" key={line.id} style={{ gap: 6 }}><Text>{line.product_name} · {stockUnitLabel(line.stock_unit, t)}</Text><Text>{t('purchaseReady.ordered')}: {quantity(line.ordered_quantity)} · {t('purchaseReady.alreadyReceived')}: {quantity(line.received_quantity)} · {t('purchasing.remaining')}: {quantity(remainingQuantity(line.ordered_quantity, line.received_quantity))}</Text></Surface>)}
    {!readOnly ? <Alert tone={order.status === 'cancelled' ? 'warning' : 'info'} title={t(order.status === 'cancelled' ? 'purchaseReady.cancelled' : order.status === 'received' ? 'purchaseReady.complete' : 'purchaseReady.nextReceive')} /> : null}
    <Alert tone="info" title={t('purchaseReady.noAmend')} />
    <Text accessibilityRole="header">{t('purchasing.receiptHistory')}</Text>
    {receipts.length ? receipts.map((receipt) => <Button key={receipt.id} variant="secondary" label={t('purchaseReady.openReceipt', { reference: receipt.receipt_number })} onPress={() => onReceipt(receipt.id)} />) : <Text>{t('purchasing.noReceipts')}</Text>}
  </Surface>;
}

export function ReceiptViewer({ organizationId, branchId, receiptId, currency, confirmation = false, onOrder }: { organizationId: string; branchId: string; receiptId: string; currency: string; confirmation?: boolean; onOrder: (id: string) => void }) {
  const { t, i18n } = useTranslation(); const timezone = useBusinessTimezone();
  const formatMoney = (n: number) => formatCurrency(n, i18n.language, currency); const { isOnline } = useConnectivity();
  const [data, setData] = useState<ReceiptDetail | null>(null);
  const [error, setError] = useState(false); const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    if (!isOnline) return () => { active = false; };
    void Promise.resolve().then(() => { if (!active) return; setData(null); setError(false); return loadReceiptDetail(organizationId, branchId, receiptId).then((detail) => { if (active) setData(detail); }); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [organizationId, branchId, receiptId, revision, isOnline]);
  const number = (value: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 3 }).format(value);
  const money = (value: number | null) => value == null ? '—' : formatMoney(value);
  return <Surface style={{ gap: 12 }}>
    <Text accessibilityRole="header">{t(confirmation ? 'purchaseReady.confirmation' : 'purchasing.receiptHistory')}</Text>
    <Text selectable>{t('purchaseReady.reference')}: {receiptId}</Text>
    {!isOnline ? <Alert tone="warning" title={t('purchaseReady.historyOffline')} /> : error ? <><Alert tone="danger" title={t('purchaseReady.detailFailed')} /><Button label={t('purchaseReady.reload')} onPress={() => setRevision((value) => value + 1)} /></> : !data ? <Text>{t('common.loading')}</Text> : <>
      <Text>{t('purchasing.receiptNumber')}: {data.receipt.receipt_number}</Text>
      <Text>{t('purchasing.supplier')}: {data.supplier.name}</Text>
      <Text>{t('purchasing.poNumber')}: {data.order.po_number}</Text>
      <Text>{t('purchaseReady.receivedAt')}: {formatInstantDateTime(data.receipt.received_at, i18n.language, timezone)}</Text>
      <Text>{t('purchasing.supplierInvoice')}: {data.receipt.supplier_invoice_number || '—'}</Text>
      <Text>{t('purchaseReady.linesReceived', { count: data.lines.length })}</Text>
      <Text>{t('purchaseReady.currentOrderStatus')}</Text><StatusBadge label={t(`purchasing.status.${data.order.status}`)} tone={data.order.status === 'received' ? 'success' : data.order.status === 'cancelled' ? 'danger' : 'info'} />
      {data.lines.map((line) => <Surface tone="inset" key={line.id} style={{ gap: 8 }}>
        <Text>{line.product_name} · {stockUnitLabel(line.stock_unit, t)}</Text><Text>{t('purchasing.quantityReceived')}: {number(line.quantity)}</Text>
        <Text>{t('purchaseReady.batchRecorded')}: {line.lot_number}</Text><Text selectable>{t('purchaseReady.batchId')}: {line.batch_id}</Text>
        <Text>{t('catalog.expiryDate')}: {formatDateOnly(line.expiry_date, i18n.language)}</Text><Text>{t('purchasing.unitCost')}: {money(line.unit_cost)}</Text><Text>{t('purchaseReady.currentPrice')}: {money(line.current_selling_price)}</Text>
        <Text selectable>{t('purchaseReady.movement')}: {line.inventory_movement_id || '—'}</Text>
        <Link href={{ pathname: '/batches', params: { batchId: line.batch_id } }} asChild><Button variant="secondary" label={t('purchaseReady.openBatch', { lot: line.lot_number })} /></Link>
      </Surface>)}
      <Text>{t('purchaseReady.priceHistoryNote')}</Text>
      {data.orderLines.map((line) => <Text key={line.id}>{line.product_name} · {t('purchasing.remaining')}: {number(remainingQuantity(line.ordered_quantity, line.received_quantity))} {stockUnitLabel(line.stock_unit, t)}</Text>)}
      <Button variant="secondary" label={t('purchaseReady.openOrder')} onPress={() => onOrder(data.order.id)} />
    </>}
  </Surface>;
}

export function ReceiptHistory({ organizationId, branchId, cached, onReceipt }: { organizationId: string; branchId: string; cached: PurchaseReceipt[]; onReceipt: (id: string) => void }) {
  const { t, i18n } = useTranslation(); const timezone = useBusinessTimezone();
 const { isOnline } = useConnectivity();
  const [query, setQuery] = useState(''); const [page, setPage] = useState(0); const [rows, setRows] = useState<PurchaseReceipt[]>([]); const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(true); const [error, setError] = useState(false); const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    if (!isOnline) return () => { active = false; };
    const timer = setTimeout(() => {
      setBusy(true); setError(false); setRows([]); setMore(false);
      void searchReceipts(organizationId, branchId, query, page).then((result) => { if (active) { setRows(result.items); setMore(result.hasMore); } }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setBusy(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [organizationId, branchId, query, page, isOnline, revision]);
  const shown = isOnline ? rows : cached;
  return <Surface style={{ gap: 12 }}><Text accessibilityRole="header">{t('purchasing.receiptHistory')}</Text>
    {isOnline ? <TextField accessibilityLabel={t('purchaseReady.historySearch')} placeholder={t('purchaseReady.historySearch')} value={query} onChangeText={(value) => { setQuery(value); setPage(0); }} /> : <Alert tone="warning" title={t('purchaseReady.historyOffline')} />}
    {busy && isOnline ? <Text>{t('common.loading')}</Text> : error ? <><Alert tone="danger" title={t('purchaseReady.detailFailed')} /><Button label={t('purchaseReady.reload')} onPress={() => setRevision((value) => value + 1)} /></> : !shown.length ? <Text>{t('purchasing.noReceipts')}</Text> : shown.map((receipt) => <View key={receipt.id} style={{ gap: 4 }}><Button variant="secondary" disabled={!isOnline} label={t('purchaseReady.openReceipt', { reference: receipt.receipt_number })} onPress={() => onReceipt(receipt.id)} /><Text>{formatInstantDateTime(receipt.received_at, i18n.language, timezone)}</Text></View>)}
    {isOnline ? <View style={{ gap: 8, flexDirection: 'row', flexWrap: 'wrap' }}><Button variant="secondary" label={t('purchaseReady.previous')} disabled={!page || busy} onPress={() => setPage((value) => value - 1)} /><Text>{t('purchaseReady.page', { page: page + 1 })}</Text><Button variant="secondary" label={t('purchaseReady.next')} disabled={!more || busy} onPress={() => setPage((value) => value + 1)} /></View> : null}
  </Surface>;
}

export function BatchProvenance({ organizationId, branchId, batchId, currency }: { organizationId: string; branchId: string; batchId: string; currency: string }) {
  const { t, i18n } = useTranslation(); const timezone = useBusinessTimezone();
  const formatMoney = (n: number) => formatCurrency(n, i18n.language, currency); const { isOnline } = useConnectivity();
  const [data, setData] = useState<Awaited<ReturnType<typeof loadBatchProvenance>> | null>(null); const [error, setError] = useState(false); const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    if (isOnline) void Promise.resolve().then(() => {
      if (!active) return;
      setData(null); setError(false);
      return loadBatchProvenance(organizationId, branchId, batchId).then((value) => { if (active) setData(value); });
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [organizationId, branchId, batchId, isOnline, revision]);
  return <Surface style={{ gap: 12 }}><Text accessibilityRole="header">{t('purchaseReady.provenance')}</Text>
    {!isOnline ? <Alert tone="warning" title={t('purchaseReady.historyOffline')} /> : error ? <><Alert tone="danger" title={t('purchaseReady.detailFailed')} /><Button label={t('purchaseReady.reload')} onPress={() => setRevision((value) => value + 1)} /></> : !data ? <Text>{t('common.loading')}</Text> : <><Text>{data.product.name} · {stockUnitLabel(data.product.stock_unit, t)}</Text><Text>{data.batch.lot_number} · {formatDateOnly(data.batch.expiry_date, i18n.language)}</Text><Text selectable>{data.batch.id}</Text><Text>{t('catalog.purchaseCost')}: {data.batch.purchase_cost == null ? '—' : formatMoney(data.batch.purchase_cost)} · {t('purchaseReady.currentPrice')}: {data.batch.selling_price == null ? '—' : formatMoney(data.batch.selling_price)}</Text>{data.balance ? <Text>{t('catalog.onHandQuantity')}: {new Intl.NumberFormat(i18n.language).format(data.balance.on_hand_quantity)} · {t('catalog.reservedQuantity')}: {new Intl.NumberFormat(i18n.language).format(data.balance.reserved_quantity)} · {t('catalog.availableQuantity')}: {new Intl.NumberFormat(i18n.language).format(data.balance.available_quantity)}</Text> : <Text>{t('catalog.balanceUnavailable')}</Text>}{data.receipts.length ? data.receipts.map((receipt) => <View key={receipt.id} style={{ gap: 4 }}><Text>{formatInstantDateTime(receipt.received_at, i18n.language, timezone)} · {receipt.supplier_name || '—'} · {receipt.po_number || '—'} · {new Intl.NumberFormat(i18n.language).format(receipt.quantity)}</Text><Link href={{ pathname: '/purchasing', params: { receiptId: receipt.id } }} asChild><Button variant="secondary" label={t('purchaseReady.openReceipt', { reference: receipt.receipt_number })} /></Link></View>) : <Text>{t('purchaseReady.noProvenance')}</Text>}</>}
  </Surface>;
}
