import { inventoryQuantity, variance } from './inventoryCompletion';
import { canApplyTransferAction, isTransferBatchEligible, type TransferAction } from './transferSafety';
import type { BatchChoice } from '../services/catalogReadiness';
import type { InventoryBalance } from '../services/inventory';
import type { StockTransfer, StockTransferLine } from '../services/transfers';

export type TransferContext = { batch: BatchChoice; balance: InventoryBalance | null };
export function transferEligibleQuantity(batch: Pick<BatchChoice, 'status' | 'expiry_date'> | undefined, balance: InventoryBalance | undefined | null, today = new Date().toISOString().slice(0, 10)): number | null {
  if (!batch || !balance || balance.available_quantity == null || !Number.isFinite(Number(balance.available_quantity)) || Number(balance.available_quantity) < 0) return null;
  return isTransferBatchEligible({ ...batch, balance: Number(balance.available_quantity) }, today) ? Number(balance.available_quantity) : 0;
}
export function transferQuantity(raw: string, context: { batch: Pick<BatchChoice, 'id' | 'organization_id' | 'branch_id' | 'status' | 'expiry_date'>; balance: InventoryBalance | null }, organizationId: string, source: string, destination: string, today = new Date().toISOString().slice(0, 10)) {
  if (!source || !destination || source === destination) throw new Error('TRANSFER_SAME_BRANCH');
  const { batch, balance } = context;
  if (batch.organization_id !== organizationId || batch.branch_id !== source || !balance || balance.batch_id !== batch.id || balance.organization_id !== organizationId || balance.branch_id !== source) throw new Error('TRANSFER_SOURCE_BATCH_INVALID');
  if (batch.status !== 'ACTIVE' || batch.expiry_date < today) throw new Error('TRANSFER_SOURCE_BATCH_NOT_ELIGIBLE');
  const quantity = inventoryQuantity(raw);
  if (balance.available_quantity == null || !Number.isFinite(Number(balance.available_quantity))) throw new Error('TRANSFER_SOURCE_BATCH_INVALID');
  if (quantity > Number(balance.available_quantity)) throw new Error('INSUFFICIENT_STOCK');
  return quantity;
}
export function receiptValues(lines: StockTransferLine[], quantities: Record<string, string>, reasons: Record<string, string>) {
  if (!lines.length || new Set(lines.map((line) => line.id)).size !== lines.length) throw new Error('TRANSFER_LINES_REQUIRED');
  return lines.map((line) => {
    const quantity = inventoryQuantity(quantities[line.id] ?? '', true);
    if (quantity > Number(line.dispatched_quantity)) throw new Error('TRANSFER_RECEIVED_QUANTITY_INVALID');
    if (quantity !== Number(line.dispatched_quantity) && !reasons[line.id]?.trim()) throw new Error('TRANSFER_DISCREPANCY_REASON_REQUIRED');
    return { line_id: line.id, quantity, reason: reasons[line.id]?.trim() || undefined };
  });
}
export const transferDifference = (expected: number, received: number) => variance(expected, received);
export const approvedQuantity = (transfer: StockTransfer, line: StockTransferLine) => transfer.approved_at ? Number(line.requested_quantity) : null;
export function transferActionInBranch(transfer: StockTransfer, action: TransferAction, branchId: string, manageBranches: boolean) {
  return canApplyTransferAction(transfer.status, action) && (manageBranches || (action === 'dispatch' ? transfer.source_branch_id === branchId : action === 'receive' ? transfer.destination_branch_id === branchId : [transfer.source_branch_id, transfer.destination_branch_id].includes(branchId)));
}
export type TransferOperation = {
  organizationId: string; branchId: string; sourceBranchId: string; destinationBranchId: string;
  action: 'request' | TransferAction; key: string; createdAt: string; phase: 'prepared' | 'dispatched';
  transferId?: string; transferNumber: string; resultId?: string; rejected?: boolean;
  lines?: { source_batch_id: string; quantity: number }[]; notes?: string;
  receivedLines?: { line_id: string; quantity: number; reason?: string }[];
  labels?: { product: string; lot: string; unit?: string; quantity: number }[];
  outcomeMismatch?: boolean;
  sourceName?: string; destinationName?: string;
};
export function assertTransferOperationScope(operation: TransferOperation, organizationId: string, branchId: string) {
  if (operation.organizationId !== organizationId || operation.branchId !== branchId) throw new Error('TRANSFER_BRANCH_CHANGED');
}
export function transferActionAccepted(transfer: StockTransfer, operation: TransferOperation) {
  if (transfer.organization_id !== operation.organizationId || transfer.source_branch_id !== operation.sourceBranchId || transfer.destination_branch_id !== operation.destinationBranchId) throw new Error('TRANSFER_BRANCH_CHANGED');
  if (operation.action === 'request') return true;
  if (operation.action === 'approve') return Boolean(transfer.approved_at);
  if (operation.action === 'dispatch') return Boolean(transfer.dispatched_at);
  if (operation.action === 'cancel') return transfer.status === 'CANCELLED';
  return transfer.status === 'RECEIVED' || transfer.status === 'RECEIVED_WITH_DISCREPANCY';
}
