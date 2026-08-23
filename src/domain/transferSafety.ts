export type TransferAction = 'approve' | 'dispatch' | 'receive' | 'cancel';
type TransferStatus = 'REQUESTED'|'APPROVED'|'DISPATCHED'|'RECEIVED'|'RECEIVED_WITH_DISCREPANCY'|'CANCELLED';
type EligibleBatch = { status: string; expiry_date: string; balance?: number };

export function isTransferBatchEligible(batch: EligibleBatch, today: string) {
  return batch.status === 'ACTIVE' && batch.expiry_date >= today && Number(batch.balance ?? 0) > 0;
}

export function canApplyTransferAction(status: TransferStatus, action: TransferAction) {
  if (action === 'approve') return status === 'REQUESTED';
  if (action === 'dispatch') return status === 'APPROVED';
  if (action === 'receive') return status === 'DISPATCHED';
  return status === 'REQUESTED' || status === 'APPROVED';
}

export function validateReceivedQuantity(quantity: number, dispatchedQuantity: number) {
  return Number.isFinite(quantity) && quantity >= 0 && quantity <= dispatchedQuantity;
}
