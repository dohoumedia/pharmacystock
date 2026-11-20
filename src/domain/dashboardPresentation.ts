import type { ExpiryRisk } from '../services/expiry';
import type { InventoryBalanceItem } from '../services/inventory';
import type { DailySalesReport } from '../services/coreCompletion';
import type { StockTransfer } from '../services/transfers';

export type StockAttention = { outOfStock: number; lowStock: number; lowStockThreshold: number | null };
export type DashboardRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export function stockRiskLevel(attention: Pick<StockAttention, 'outOfStock' | 'lowStock'>): DashboardRiskLevel {
  return attention.outOfStock > 0 ? 'critical' : attention.lowStock > 0 ? 'high' : 'low';
}

export function stockRiskCopyKey(attention: Pick<StockAttention, 'outOfStock' | 'lowStock'>): 'outOfStock' | 'lowStock' {
  return attention.outOfStock > 0 || attention.lowStock === 0 ? 'outOfStock' : 'lowStock';
}

export function expiryRiskLevel(daysRemaining: (number | string | null | undefined)[]): DashboardRiskLevel {
  return daysRemaining.some((days) => Number(days) < 0) ? 'critical' : daysRemaining.length > 0 ? 'high' : 'low';
}

export function transferRiskLevel(openTransfers: number): DashboardRiskLevel {
  return openTransfers > 0 ? 'medium' : 'low';
}

/** Aggregate eligible balances by product before applying the configured threshold. */
export function getStockAttention(balances: InventoryBalanceItem[], lowStockThreshold: number | null, today = localDateKey()): StockAttention {
  const products = new Map<string, { quantity: number; available: number; unknown: boolean }>();
  for (const item of balances) {
    if (item.batch_status !== 'ACTIVE' || item.expiry_date < today) continue;
    const id = item.product_id || item.batch_id;
    const current = products.get(id) || { quantity: 0, available: 0, unknown: false };
    const quantity = item.available_quantity == null ? NaN : Number(item.available_quantity);
    if (!Number.isFinite(quantity)) current.unknown = true;
    else { current.available += quantity; current.quantity += item.selling_price == null ? 0 : quantity; }
    products.set(id, current);
  }
  const known = [...products.values()].filter(product => !product.unknown);
  return {
    outOfStock: known.filter(product => product.available <= 0).length,
    lowStock: lowStockThreshold === null ? 0 : known.filter(product => product.quantity > 0 && product.quantity <= lowStockThreshold).length,
    lowStockThreshold,
  };
}

export function getExpiryAttention(risk: ExpiryRisk[]) {
  return risk.filter((item) => item.risk_bucket !== null && item.risk_bucket !== 'OK' && Number(item.on_hand_quantity) > 0);
}

export function getTransferAttention(transfers: StockTransfer[], branchId: string) {
  return transfers.filter((transfer) =>
    (transfer.source_branch_id === branchId || transfer.destination_branch_id === branchId) &&
    ['REQUESTED', 'APPROVED', 'DISPATCHED'].includes(transfer.status),
  );
}

export function getTodaysSales(sales: DailySalesReport[], today: string) {
  const row = sales.find((sale) => sale.sale_date === today);
  return { saleCount: Number(row?.sale_count ?? 0), grossSales: Number(row?.gross_sales ?? 0) };
}

export function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
