import type { Payment, SaleItem, SaleQuote } from '../services/sales';
import { hasDecimalPrecision, parseLocaleNumber } from './numericInput';

export function stockQuantity(raw: string): number | null {
  const value = parseLocaleNumber(raw);
  return value !== null && value > 0 && value < 1e12 && hasDecimalPrecision(value, 4) ? value : null;
}
export function cashPayment(due: number, raw: string) {
  const tender = parseLocaleNumber(raw);
  if (tender === null || !hasDecimalPrecision(tender, 2) || tender < due || tender >= 1e12 || due <= 0) return null;
  return { tendered: tender, change: Math.round((tender - due) * 100) / 100 };
}
export function quoteFingerprint(quote: SaleQuote) {
  return JSON.stringify({ total: Number(quote.total_amount), items: quote.items.map(i => [i.product_id, i.batch_id, Number(i.quantity), Number(i.unit_price), Number(i.line_total), i.expiry_date]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) });
}
export function refundableQuantity(item: SaleItem, refunds: { sale_item_id: string; quantity: number }[]) {
  return Math.max(0, Math.round((Number(item.quantity) - refunds.filter(r => r.sale_item_id === item.id).reduce((sum, r) => sum + Number(r.quantity), 0)) * 1e4) / 1e4);
}
export function refundSelection(item: SaleItem | undefined, raw: string, refunds: { sale_item_id: string; quantity: number }[]) {
  const quantity = stockQuantity(raw);
  if (!item || quantity === null || quantity > refundableQuantity(item, refunds)) return null;
  return { sale_item_id: item.id, quantity, amount: Math.round(quantity * Number(item.unit_price) * 100) / 100 };
}
export function barcodeProductIds(rows: { product_id: string }[]) { return [...new Set(rows.map(row => row.product_id))]; }
export function paymentKey(method: Payment['method']) { return `pos.${({ CASH: 'cash', CARD: 'card', MOBILE_MONEY: 'mobileMoney', BANK_TRANSFER: 'bankTransfer', OTHER: 'other' } as const)[method]}`; }
