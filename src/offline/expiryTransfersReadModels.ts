import type { ExpiryAction, ExpiryAlert, ExpiryPolicy, ExpiryRisk } from '@/services/expiry';
import type { StockTransfer, StockTransferLine, TransferBatch } from '@/services/transfers';
import { LocalStore } from './localStore';

export type ExpiryReadModel = { risk: ExpiryRisk[]; alerts: ExpiryAlert[]; actions: ExpiryAction[]; policy: ExpiryPolicy | null };
export type TransfersReadModel = { transfers: StockTransfer[]; transferableBatches: TransferBatch[] };

const expiryKey = (organizationId: string, branchId: string) => `expiry:read:${organizationId}:${branchId}`;
const transfersKey = (organizationId: string, branchId: string) => `transfers:read:${organizationId}:${branchId}`;
const transferLinesKey = (organizationId: string, transferId: string) => `transfers:lines:${organizationId}:${transferId}`;

export function cacheExpiryReadModel(store: LocalStore, organizationId: string, branchId: string, data: ExpiryReadModel) {
  store.set(expiryKey(organizationId, branchId), { data, syncedAt: new Date().toISOString() });
}
export function getCachedExpiryReadModel(store: LocalStore, organizationId: string, branchId: string) {
  return store.get<ExpiryReadModel>(expiryKey(organizationId, branchId));
}
export function cacheTransfersReadModel(store: LocalStore, organizationId: string, branchId: string, data: TransfersReadModel) {
  store.set(transfersKey(organizationId, branchId), { data, syncedAt: new Date().toISOString() });
}
export function getCachedTransfersReadModel(store: LocalStore, organizationId: string, branchId: string) {
  return store.get<TransfersReadModel>(transfersKey(organizationId, branchId));
}
export function cacheTransferLines(store: LocalStore, organizationId: string, transferId: string, data: StockTransferLine[]) {
  store.set(transferLinesKey(organizationId, transferId), { data, syncedAt: new Date().toISOString() });
}
export function getCachedTransferLines(store: LocalStore, organizationId: string, transferId: string) {
  return store.get<StockTransferLine[]>(transferLinesKey(organizationId, transferId));
}
