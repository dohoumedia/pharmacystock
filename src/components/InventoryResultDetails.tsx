import { useBusinessTimezone } from '../hooks/useBusinessTimezone';
import { Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useTranslation } from '../i18n/useTranslation';
import { Surface } from './ui';
import type { BatchChoice } from '@/services/catalogReadiness';
import type { InventoryBalance, InventoryMovement } from '@/services/inventory';
import { variance, type AdjustmentRequest } from '../domain/inventoryCompletion';
import { stockUnitLabel } from '../domain/stockUnits';
import { formatInstantDateTime } from '../utils/dateFormatting';
import { errorPresentationKey } from '../utils/errorPresentation';

export function inventoryErrorKey(cause: unknown) {
  const message = cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : '';
  if (message.includes('QUANTITY_INVALID')) return 'inventoryReady.invalidQuantity';
  if (message.includes('REASON_REQUIRED')) return 'inventoryReady.missingReason';
  if (message.includes('INSUFFICIENT_STOCK')) return 'inventory.insufficientStock';
  if (message.includes('STATUS_BLOCKS_INBOUND')) return 'inventoryReady.inboundBlocked';
  if (message.includes('BATCH_INVALID') || message.includes('BRANCH_CHANGED')) return 'inventoryReady.invalidBatch';
  if (message.includes('COUNT_CHANGED')) return 'inventoryReady.countChanged';
  if (message.includes('COUNT_INCOMPLETE')) return 'inventoryReady.incomplete';
  if (message.includes('STOCK_COUNT_NOT_OPEN')) return 'inventoryReady.notOpen';
  return errorPresentationKey(cause);
}
export function BatchIdentity({ batch }: { batch: BatchChoice }) {
  const { t } = useTranslation();
  return <View style={{ gap: 4 }}><Text style={{ fontWeight: '700' }}>{batch.product_name} · {stockUnitLabel(batch.stock_unit, t)}</Text><Text>{t('catalog.lotNumber')}: {batch.lot_number}</Text><Link href={{ pathname: '/batches', params: { batchId: batch.id } }}>{t('inventoryReady.batchDetails')}</Link></View>;
}
export function MovementDetail({ movement, batch }: { movement: InventoryMovement; batch?: BatchChoice }) {
  const { t, i18n } = useTranslation(); const timezone = useBusinessTimezone();
  return <View style={{ gap: 4, paddingVertical: 8 }}>{batch ? <BatchIdentity batch={batch} /> : <Text>{t('inventoryReady.batchId')}: {movement.batch_id}</Text>}<Text>{t('inventoryReady.movement')}: {movement.id}</Text><Text>{t('inventoryReady.difference')}: {new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 4, signDisplay: 'always' }).format(Number(movement.quantity_delta))}</Text><Text>{t('inventory.reason')}: {movement.reference_type === 'STOCK_COUNT' ? t('inventoryReady.countReason') : movement.reason ?? '—'}</Text><Text>{t('inventoryReady.reference')}: {movement.reference_id ?? '—'}</Text><Text>{t('inventoryReady.timestamp')}: {formatInstantDateTime(movement.created_at, i18n.language, timezone)}</Text></View>;
}
export function AdjustmentConfirmation({ request, movement, balance }: { request: AdjustmentRequest; movement: InventoryMovement | null; balance: InventoryBalance | null }) {
  const { t, i18n } = useTranslation();
  const number = (value: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 4 }).format(value);
  return <Surface style={{ gap: 8 }}><Text style={{ fontWeight: '800' }}>{t('inventoryReady.adjustmentAccepted')}</Text><BatchIdentity batch={request.batch} /><Text>{t('inventoryReady.observedBefore')}: {number(request.observedOnHand)}</Text><Text>{t('inventoryReady.difference')}: {number(request.quantityDelta)}</Text><Text>{t('inventoryReady.previewResult')}: {number(variance(request.observedOnHand, -request.quantityDelta))}</Text><Text>{t('inventoryReady.currentResult')}: {balance ? number(Number(balance.on_hand_quantity)) : t('inventoryReady.unavailable')}</Text><Text>{t('inventory.reason')}: {request.reason}</Text><Text>{t('inventoryReady.movement')}: {request.resultId}</Text><Text>{t('inventoryReady.snapshotNote')}</Text>{movement ? <MovementDetail movement={movement} /> : <Text>{t('inventoryReady.detailRetry')}</Text>}</Surface>;
}
