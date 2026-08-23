import type { DailySalesReport, InventoryValueReport } from '../services/coreCompletion';
import { LocalStore } from './localStore';

export type ReportsReadModel = { dailySales: DailySalesReport[]; inventoryValue: InventoryValueReport | null };
const key = (organizationId: string, branchId: string) => `core:reports:${organizationId}:${branchId}`;

export function cacheReports(store: LocalStore, organizationId: string, branchId: string, data: ReportsReadModel, syncedAt = new Date().toISOString()) {
  store.set(key(organizationId, branchId), { data, syncedAt });
}

export function getCachedReports(store: LocalStore, organizationId: string, branchId: string) {
  return store.get<ReportsReadModel>(key(organizationId, branchId));
}
