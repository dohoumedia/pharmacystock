import { isBatchSellable } from './inventorySafety';
import type { ExpiryRisk } from '../services/expiry';
import type { InventoryBalanceItem } from '../services/inventory';
import type { DailySalesReport } from '../services/coreCompletion';
import type { StockTransfer } from '../services/transfers';

export type StockAttention = { outOfStock: number; lowStock: number; lowStockThreshold: number | null };

export function getStockAttention(balances: InventoryBalanceItem[], lowStockThreshold: number | null): StockAttention {
  const eligible = balances.filter((item) => isBatchSellable(item.batch_status, item.expiry_date));
  const outOfStock = eligible.filter((item) => Number(item.available_quantity) <= 0).length;
  const lowStock = lowStockThreshold === null
    ? 0
    : eligible.filter((item) => {
        const quantity = Number(item.available_quantity);
        return quantity > 0 && quantity <= lowStockThreshold;
      }).length;
  return { outOfStock, lowStock, lowStockThreshold };
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
