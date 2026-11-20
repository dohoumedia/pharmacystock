import { loadOrganizationSettings } from '../services/coreCompletion';
import type { ReceiptContext } from './Receipt';
import { useEffect, useState } from 'react';
import { Link } from 'expo-router';
import { Text, View } from 'react-native';
import { useTranslation } from '../i18n/useTranslation';
import { Alert, Button, Surface } from './ui';
import { SaleDetails } from './SaleDetails';
import { OrderSummary, ReceiptViewer } from './PurchasingDetails';
import { TransferDetails } from './TransferDetails';
import { CountVariance } from './PhysicalCounts';
import { MovementDetail, BatchIdentity } from './InventoryResultDetails';
import { loadOrderDetail } from '../services/purchasingDetails';
import { loadTransferDetail } from '../services/transferCompletion';
import { loadCountDetail, loadInventoryBatch } from '../services/inventoryCompletion';
import { readReportMovement } from '../services/operationalReports';
import type { reportTarget } from '../domain/operationalReports';

type Detail = { kind: 'order'; value: Awaited<ReturnType<typeof loadOrderDetail>> } | { kind: 'transfer'; value: Awaited<ReturnType<typeof loadTransferDetail>> } | { kind: 'count'; value: Awaited<ReturnType<typeof loadCountDetail>> } | { kind: 'batch'; value: Awaited<ReturnType<typeof loadInventoryBatch>> } | { kind: 'movement'; value: Awaited<ReturnType<typeof readReportMovement>> };
export function ReportDrilldown({ target, organizationId, branchId, userId, business, branchName, currency, branches, online, receiptContext, onClose, onProduct }: {
  target: ReturnType<typeof reportTarget>; organizationId: string; branchId: string; userId: string; business: string; branchName: string; currency: string; branches: { id: string; name: string }[]; online: boolean; onClose: () => void; onProduct: (id: string) => void; receiptContext?: ReceiptContext;
}) {
  const { t } = useTranslation();
  const [footer, setFooter] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null), [error, setError] = useState(false), [receipt, setReceipt] = useState<string | null>(null), [supplierOpen, setSupplierOpen] = useState(false);
  useEffect(() => { let active = true; if (online) void loadOrganizationSettings(organizationId).then(value => { if (active) setFooter(value?.receipt_footer ?? null); }).catch(() => { if (active) setError(true); }); return () => { active = false; }; }, [organizationId, online]);

  useEffect(() => {
    let active = true;
    const load = async (): Promise<Detail | null> => {
      if (target.kind === 'order') return { kind: 'order', value: await loadOrderDetail(organizationId, branchId, target.id) };
      if (target.kind === 'transfer') return { kind: 'transfer', value: await loadTransferDetail(organizationId, target.id) };
      if (target.kind === 'count') return { kind: 'count', value: await loadCountDetail(organizationId, branchId, target.id) };
      if (target.kind === 'batch') return { kind: 'batch', value: await loadInventoryBatch(organizationId, branchId, target.id) };
      if (target.kind === 'movement') return { kind: 'movement', value: await readReportMovement(organizationId, branchId, target.id) };
      return null;
    };
    if (online) void load().then(value => { if (active) setDetail(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [target, organizationId, branchId, online]);
  if (!online) return <Alert tone="warning" title={t('posReady.offline')} />;
  if (target.kind === 'sale') return <SaleDetails {...receiptContext} footer={footer} organizationId={organizationId} branchId={branchId} saleId={target.id} userId={userId} business={business} branchName={branchName} canRefund={false} online={online} onClose={onClose} onChanged={() => {}} />;
  return <Surface style={{ gap: 12 }}><Button label={t('reportsReady.close')} onPress={onClose} />
    {target.kind === 'product' ? <Button label={t('reportsReady.types.inventory')} onPress={() => onProduct(target.id)} /> : error ? <Alert tone="danger" title={t('reportsReady.error')} /> : !detail ? <Text>{t('reportsReady.loading')}</Text> : null}
    {detail?.kind === 'order' ? <><OrderSummary readOnly detail={detail.value} branchName={branchName} onReceipt={setReceipt} onSupplier={() => setSupplierOpen(v => !v)} />{supplierOpen ? <Text>{detail.value.supplier.name} · {detail.value.supplier.phone} · {detail.value.supplier.email} · {detail.value.supplier.address}</Text> : null}<Link href="/purchasing">{t('reportsReady.types.purchasing')}</Link>{receipt ? <ReceiptViewer organizationId={organizationId} branchId={branchId} receiptId={receipt} currency={currency} onOrder={() => setReceipt(null)} /> : null}</> : null}
    {detail?.kind === 'transfer' ? <TransferDetails detail={detail.value} branches={branches} /> : null}
    {detail?.kind === 'count' ? <><Text>{detail.value.count.id} · {detail.value.count.notes}</Text><CountVariance draft={{ id: detail.value.count.id, organizationId, branchId, createdAt: detail.value.count.created_at, phase: 'completed', entries: detail.value.entries }} />{detail.value.movements.map(m => <MovementDetail key={m.id} movement={m} />)}</> : null}
    {detail?.kind === 'batch' ? <><BatchIdentity batch={detail.value.batch} /><Text>{t('reportsReady.columns.on_hand')}: {detail.value.balance?.on_hand_quantity ?? t('reportsReady.unavailable')}</Text></> : null}
    {detail?.kind === 'movement' ? <View><MovementDetail movement={detail.value} /></View> : null}
  </Surface>;
}
