import { useBusinessTimezone } from '../hooks/useBusinessTimezone';
import { Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useTranslation } from '../i18n/useTranslation';
import { BatchStatusBadge } from './BatchStatusBadge';
import { MovementDetail } from './InventoryResultDetails';
import { stockUnitLabel } from '../domain/stockUnits';
import { isBatchSellable, type BatchSafetyStatus } from '../domain/inventorySafety';
import { expiryCategory } from '../domain/expiryCompletion';
import { formatDateOnly, formatInstantDateTime } from '../utils/dateFormatting';
import { errorPresentationKey } from '../utils/errorPresentation';
import type { BatchChoice } from '../services/catalogReadiness';
import type { InventoryBalance } from '../services/inventory';
import type { loadExpiryActionDetail } from '../services/expiryCompletion';

export function expiryErrorKey(cause: unknown) {
  const message = cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : '';
  if (message.includes('THRESHOLDS')) return 'expiryReady.invalidThresholds';
  if (message.includes('QUANTITY_INVALID') || message.includes('RETURN_QUANTITY')) return 'expiryReady.invalidQuantity';
  if (message.includes('REASON_REQUIRED')) return 'expiryReady.reasonRequired';
  if (message.includes('INSUFFICIENT_STOCK')) return 'expiryReady.insufficient';
  if (message.includes('STATUS_UNCERTAIN') || message.includes('HISTORY_INCOMPLETE')) return 'expiryReady.statusUncertain';
  if (message.includes('STOCK_CHANGED')) return 'expiryReady.stockChanged';
  if (message.includes('BALANCE_UNAVAILABLE')) return 'expiryReady.balanceUnavailable';
  if (message.includes('INELIGIBLE') || message.includes('NOT_ELIGIBLE') || message.includes('NOT_RETURNABLE')) return 'expiryReady.ineligible';
  if (message.includes('BRANCH_CHANGED')) return 'expiryReady.branchChanged';
  return errorPresentationKey(cause);
}
export function ExpiryBatchSummary({ batch, balance, branchName }: { batch: BatchChoice; balance: InventoryBalance | null; branchName: string }) {
  const { t, i18n } = useTranslation();
  const number = (value: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 4 }).format(Number(value));
  const unit = stockUnitLabel(batch.stock_unit, t);
  return <View style={{ gap: 6 }}><Text style={{ fontWeight: '800' }}>{batch.product_name} · {batch.lot_number}</Text><Text>{t('organization.branch')}: {branchName}</Text><Text>{t('expiry.expires')}: {formatDateOnly(batch.expiry_date, i18n.language)}</Text><BatchStatusBadge status={(['ACTIVE', 'QUARANTINED', 'RECALLED', 'EXPIRED', 'DEPLETED', 'DISPOSED'].includes(batch.status) ? batch.status : 'UNKNOWN') as BatchSafetyStatus} /><Text>{t(isBatchSellable(batch.status, batch.expiry_date) && balance && Number(balance.available_quantity) > 0 ? 'expiryReady.sellable' : 'expiryReady.blocked')}</Text><Text>{t('inventory.onHand')}: {balance ? `${number(balance.on_hand_quantity)} ${unit}` : t('expiryReady.balanceUnavailable')}</Text><Text>{t('production.inventoryView.reserved')}: {balance ? number(balance.reserved_quantity) : '—'} · {t('production.inventoryView.available')}: {balance && isBatchSellable(batch.status, batch.expiry_date) ? number(balance.available_quantity) : '—'}</Text><Link href={{ pathname: '/batches', params: { batchId: batch.id } }}>{t('inventoryReady.batchDetails')}</Link></View>;
}
export function ExpiryRiskLabel({ days, thresholds }: { days: number | null; thresholds: number[] }) {
  const { t } = useTranslation();
  const category = expiryCategory(days, thresholds);
  return <Text>{category.kind === 'SOON' ? t('expiryReady.withinDays', { days: category.threshold }) : t(`expiryReady.risk.${category.kind}`)}</Text>;
}
export function ExpiryHistoryDetail({ detail, branchName }: { detail: Awaited<ReturnType<typeof loadExpiryActionDetail>>; branchName: string }) {
  const { t, i18n } = useTranslation(); const timezone = useBusinessTimezone();
  return <View style={{ gap: 8 }}><ExpiryBatchSummary batch={detail.batch} balance={detail.balance} branchName={branchName} /><Text style={{ fontWeight: '800' }}>{t(`expiry.action.${detail.action.action_type}`)}</Text><Text>{t('expiryReady.actionReference')}: {detail.action.id}</Text><Text>{t('inventoryReady.timestamp')}: {formatInstantDateTime(detail.action.created_at, i18n.language, timezone)}</Text><Text>{t('expiryReady.reason')}: {detail.action.reason ?? '—'}</Text><Text>{t('inventory.quantity')}: {detail.action.quantity === null ? t('expiryReady.statusOnly') : `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 4 }).format(Number(detail.action.quantity))} ${stockUnitLabel(detail.batch.stock_unit, t)}`}</Text>{detail.movement ? <MovementDetail movement={detail.movement} /> : <Text>{t(detail.action.quantity === null ? 'expiryReady.noMovement' : 'expiryReady.movementUnavailable')}</Text>}<Text>{t('expiryReady.currentSnapshot')}</Text></View>;
}
