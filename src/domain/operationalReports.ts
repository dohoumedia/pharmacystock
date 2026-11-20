import { validDateOnly } from './numericInput';

export const REPORTS = ['sales', 'payments', 'refunds', 'inventory', 'attention', 'expiry', 'purchasing', 'movements', 'counts', 'transfers'] as const;
export type ReportKind = typeof REPORTS[number];
export type ReportFilters = { report: ReportKind; start: string; end: string; search: string; state: string; supplier: string; days: number; page: number; productId?: string };
export type ReportValue = string | number | boolean | null;
export type ReportRow = { id: string; [key: string]: ReportValue };
export type PaymentMethodSummary = { method: string; transaction_count: number; amount: number; reversed_count: number };
export type ReportSummary = { [key: string]: ReportValue | PaymentMethodSummary[] | { stock_unit: string; quantity: number }[] };
export type OperationalReport = { rows: ReportRow[]; total: number; summary: ReportSummary; timezone: string; business_date: string; generated_at: string; start: string; end: string; branch_id: string; page: number; page_size: number };

/** Calendar dates in the configured branch/organization zone, never the device zone. */
export function businessDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (key: string) => parts.find(p => p.type === key)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function shiftBusinessDate(date: string, days: number): string {
  if (!validDateOnly(date) || !Number.isInteger(days)) throw new Error('REPORT_FILTER_INVALID');
  const instant = new Date(`${date}T12:00:00Z`); instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}
export function reportPeriod(mode: 'today' | 'yesterday' | 'custom', today: string, start: string, end: string) {
  if (mode === 'custom') return { start, end };
  const date = mode === 'today' ? today : shiftBusinessDate(today, -1);
  return { start: date, end: date };
}
export function validateReportFilters(filters: ReportFilters) {
  if (!REPORTS.includes(filters.report) || !validDateOnly(filters.start) || !validDateOnly(filters.end) || filters.start > filters.end ||
    !Number.isInteger(filters.page) || filters.page < 0 || filters.page > 1000000 ||
    !Number.isInteger(filters.days) || filters.days < 0 || filters.days > 3650 ||
    filters.search.length > 200 || filters.supplier.length > 200 || filters.state.length > 60) throw new Error('REPORT_FILTER_INVALID');
}
// Stable export order shared by the report display. Raw status/ISO values stay unambiguous.
export const reportColumns: Record<ReportKind, readonly string[]> = {
  sales: ['reference', 'timestamp', 'status', 'amount', 'currency_code', 'sale_id'],
  payments: ['reference', 'sale_number', 'timestamp', 'method', 'status', 'amount', 'currency_code', 'external_reference', 'sale_id'],
  refunds: ['reference', 'sale_number', 'timestamp', 'amount', 'currency_code', 'reason', 'sale_id'],
  inventory: ['product', 'lot_number', 'stock_unit', 'on_hand', 'reserved', 'available', 'sellable', 'status', 'expiry_date', 'purchase_cost', 'selling_price', 'cost_value', 'retail_value', 'missing_balance', 'id'],
  attention: ['product', 'stock_unit', 'on_hand', 'sellable', 'batches', 'attention', 'missing_balance', 'id'],
  expiry: ['product', 'lot_number', 'stock_unit', 'on_hand', 'reserved', 'available', 'status', 'expiry_date', 'risk', 'missing_balance', 'id'],
  purchasing: ['reference', 'timestamp', 'supplier', 'status', 'ordered_value', 'received_value', 'outstanding_value', 'missing_cost', 'missing_received_cost', 'id'],
  movements: ['timestamp', 'product', 'lot_number', 'stock_unit', 'movement_type', 'quantity_delta', 'reason', 'reference_type', 'reference_id', 'source', 'batch_id', 'id'],
  counts: ['reference', 'timestamp', 'counted_at', 'status', 'lines', 'notes', 'id'],
  transfers: ['reference', 'timestamp', 'status', 'source_branch_id', 'destination_branch_id', 'lines', 'discrepancy_lines', 'id'],
};
export const financeColumns = new Set(['purchase_cost', 'selling_price', 'cost_value', 'retail_value']);
export function reportFilename(report: ReportKind, branch: string, start: string, end: string) {
  const safe = (value: string) => value.normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '-').replace(/[. ]+$/g, '').replace(/\s+/g, '-').slice(0, 80) || 'branch';
  return `${report}-${safe(branch)}-${safe(start)}-${safe(end)}.csv`;
}
export function reportTarget(kind: ReportKind, row: ReportRow): { kind: 'sale' | 'batch' | 'product' | 'order' | 'count' | 'transfer' | 'movement'; id: string } {
  if (kind === 'sales' || kind === 'refunds' || kind === 'payments') return { kind: 'sale', id: String(row.sale_id) };
  if (kind === 'inventory' || kind === 'expiry') return { kind: 'batch', id: row.id };
  if (kind === 'attention') return { kind: 'product', id: row.id };
  if (kind === 'purchasing') return { kind: 'order', id: row.id };
  if (kind === 'counts') return { kind: 'count', id: row.id };
  if (kind === 'transfers') return { kind: 'transfer', id: row.id };
  return { kind: 'movement', id: row.id };
}

/** RFC 4180 output with UTF-8 BOM for spreadsheet readers. Values never form CSV syntax. */
export function reportCsv(columns: readonly string[], rows: Record<string, ReportValue>[], label: (key: string) => string) {
  const quote = (value: ReportValue): string => {
    let raw = value === null ? '' : String(value);
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(raw)) raw = `'${raw}`;
    return `"${raw.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + [columns.map(c => quote(label(c))).join(','), ...rows.map(r => columns.map(c => quote(r[c] ?? null)).join(','))].join('\r\n') + '\r\n';
}

export const reportStates: Record<ReportKind, readonly string[]> = {
  sales: ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'],
  refunds: [], payments: ['CASH', 'CARD', 'MOBILE_MONEY', 'BANK_TRANSFER', 'OTHER', 'RECORDED', 'REVERSED'],
  inventory: ['ACTIVE', 'QUARANTINED', 'RECALLED', 'EXPIRED', 'DEPLETED', 'DISPOSED'],
  expiry: ['expired', 'near', 'ACTIVE', 'QUARANTINED', 'RECALLED'],
  attention: ['low', 'out', 'no_sellable', 'unknown'],
  purchasing: ['draft', 'ordered', 'partially_received', 'received', 'cancelled'],
  movements: ['PURCHASE_RECEIPT', 'SALE', 'RETURN_IN', 'RETURN_OUT', 'TRANSFER_IN', 'TRANSFER_OUT', 'DAMAGE', 'EXPIRY', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'COUNT_CORRECTION_IN', 'COUNT_CORRECTION_OUT', 'SUPPLIER_RETURN', 'DISPOSAL'],
  counts: ['OPEN', 'COMPLETED', 'CANCELLED'],
  transfers: ['REQUESTED', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'RECEIVED_WITH_DISCREPANCY', 'CANCELLED'],
};
