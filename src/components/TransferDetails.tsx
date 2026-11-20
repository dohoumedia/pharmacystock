import { Text, View } from 'react-native';
import { useTranslation } from '../i18n/useTranslation';
import { Surface } from './ui';
import { stockUnitLabel } from '../domain/stockUnits';
import { approvedQuantity } from '../domain/transferCompletion';
import { formatDateOnly, formatInstantDateTime } from '../utils/dateFormatting';
import type { TransferDetail } from '../services/transferCompletion';
import type { StockTransfer } from '../services/transfers';
import { errorPresentationKey } from '../utils/errorPresentation';

export function transferErrorKey(cause: unknown) {
  const code = cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : '';
  return /^(TRANSFER_|INVENTORY_QUANTITY_INVALID|INSUFFICIENT_STOCK|DESTINATION_BRANCH_INVALID|SOURCE_BRANCH_ACCESS_DENIED)/.test(code) ? `transferReady.errors.${code}` : errorPresentationKey(cause);
}

export const transferStatusKey = (status: StockTransfer['status']) => `transferReady.status.${status}`;
export function TransferDetails({ detail, branches }: { detail: TransferDetail; branches: { id: string; name: string }[] }) {
  const { t, i18n } = useTranslation();
  const number = (value: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 4 }).format(value);
  const branch = (id: string) => detail.branches.find((row) => row.id === id)?.name || branches.find((row) => row.id === id)?.name || t('transferReady.unavailable');
  const actor = (id: string | null | undefined) => detail.profiles.find((row) => row.user_id === id)?.display_name || t('transferReady.unavailable');
  const transfer = detail.transfer;
  return <View style={{ gap: 12 }}>
    <Text accessibilityRole="header" style={{ fontWeight: '800', fontSize: 21 }}>{transfer.transfer_number}</Text>
    <Text>{t('transferReady.route', { source: branch(transfer.source_branch_id), destination: branch(transfer.destination_branch_id) })}</Text>
    <Text>{t(transferStatusKey(transfer.status))}</Text><Text>{t('transferReady.bound')}</Text>
    <Text>{t('transferReady.lifecycle')}</Text>
    <Text>{t('transferReady.requester')}: {actor(transfer.requested_by)} · {formatInstantDateTime(transfer.requested_at, i18n.language)}</Text>
    {transfer.notes ? <Text>{t('transferReady.notes')}: {transfer.notes}</Text> : null}
    {detail.lines.map((line) => {
      const product = detail.products.find((row) => row.id === line.product_id);
      const source = detail.batches.find((row) => row.id === line.source_batch_id);
      const destination = detail.batches.find((row) => row.id === line.destination_batch_id);
      const approved = approvedQuantity(transfer, line);
      const quantity = (value: number) => `${number(value)} ${stockUnitLabel(product?.stock_unit, t)}`;
      return <Surface key={line.id} style={{ gap: 8 }}>
        <Text style={{ fontWeight: '800' }}>{product?.name || t('transferReady.unavailable')}</Text>
        <Text>{t('transferReady.sku')}: {product?.sku || '—'} · {t('transferReady.barcode')}: {detail.barcodes.filter((row) => row.product_id === line.product_id).map((row) => row.barcode).join(', ') || '—'}</Text>
        <Text>{t('transferReady.lot')}: {source?.lot_number || destination?.lot_number || t('transferReady.unavailable')} · {t('transferReady.expiry')}: {formatDateOnly(source?.expiry_date || destination?.expiry_date, i18n.language)}</Text>
        <Text>{t('transferReady.sourceStatus')}: {source ? t(`production.batchStatus.${source.expiry_date < new Date().toISOString().slice(0, 10) ? 'expired' : source.status.toLowerCase()}`) : t('transferReady.unavailable')}</Text>
        <Text>{t('transferReady.requested')}: {quantity(Number(line.requested_quantity))}</Text>
        <Text>{t('transferReady.approved')}: {approved === null ? '—' : quantity(approved)}</Text>
        <Text>{t('transferReady.dispatched')}: {quantity(Number(line.dispatched_quantity))} · {t('transferReady.received')}: {quantity(Number(line.received_quantity))}</Text>
        <Text>{t('transferReady.difference')}: {quantity(Number(line.discrepancy_quantity))}{line.discrepancy_reason ? ` · ${line.discrepancy_reason}` : ''}</Text>
        <Text selectable>{t('transferReady.sourceBatch')}: {line.source_batch_id}</Text><Text selectable>{t('transferReady.destinationBatch')}: {line.destination_batch_id || '—'}</Text>
        {[['source', line.source_batch_id, transfer.source_branch_id], ['destination', line.destination_batch_id, transfer.destination_branch_id]].map(([side, batchId, branchId]) => {
          const balance = detail.balances.find((row) => row.batch_id === batchId && row.branch_id === branchId);
          return <View key={side} style={{ gap: 4 }}><Text style={{ fontWeight: '700' }}>{t(`transferReady.${side}`)}: {branch(branchId!)}</Text><Text>{t('transferReady.currentStock')}: {balance ? t('transferReady.balance', { onHand: quantity(Number(balance.on_hand_quantity)), reserved: quantity(Number(balance.reserved_quantity)), available: quantity(Number(balance.available_quantity)) }) : t('transferReady.balanceUnavailable')}</Text></View>;
        })}
        {[line.transfer_out_movement_id, line.transfer_in_movement_id].filter(Boolean).map((id) => {
          const movement = detail.movements.find((row) => row.id === id);
          return <View key={id} style={{ gap: 4 }}><Text selectable>{t('transferReady.movement')}: {id}</Text>{movement ? <><Text>{branch(movement.branch_id)} · {quantity(Number(movement.quantity_delta))} · {formatInstantDateTime(movement.occurred_at, i18n.language)}</Text><Text selectable>{t('transferReady.reference')}: {movement.reference_id}</Text></> : <Text>{t('transferReady.movementUnavailable')}</Text>}</View>;
        })}
      </Surface>;
    })}
    {transfer.status === 'DISPATCHED' ? <Text>{t('transferReady.awaitingReceipt')}</Text> : null}
    {transfer.status === 'RECEIVED_WITH_DISCREPANCY' ? <><Text accessibilityRole="alert">{t('transferReady.discrepancyFinal')}</Text><Text>{transfer.discrepancy_notes || '—'}</Text></> : null}
    {['DISPATCHED', 'RECEIVED', 'RECEIVED_WITH_DISCREPANCY'].includes(transfer.status) ? <Text>{t('transferReady.cannotCancel')}</Text> : null}
    <Text style={{ fontWeight: '800' }}>{t('transferReady.history')}</Text>
    {transfer.status === 'CANCELLED' ? <Text>{t('transferReady.status.CANCELLED')} · {formatInstantDateTime(transfer.updated_at, i18n.language)} · {t('transferReady.cancelActorUnavailable')}</Text> : null}
    {[[transfer.requested_at, transfer.requested_by, 'REQUESTED'], [transfer.approved_at, transfer.approved_by, 'APPROVED'], [transfer.dispatched_at, transfer.dispatched_by, 'DISPATCHED'], [transfer.received_at, transfer.received_by, transfer.status]].filter(([at]) => at).map(([at, user, status]) => <Text key={status}>{t(`transferReady.status.${status}`)} · {actor(user)} · {formatInstantDateTime(at, i18n.language)}</Text>)}
    {detail.historyUnavailable ? <Text>{t('transferReady.historyUnavailable')}</Text> : detail.history.map((event) => <Text key={event.id} selectable>{t(`transferReady.events.${event.event_type.replace('transfer.', '')}`)} · {formatInstantDateTime(event.created_at, i18n.language)} · {event.id}</Text>)}
    <Text selectable>{t('transferReady.reference')}: {transfer.id}</Text>
  </View>;
}
