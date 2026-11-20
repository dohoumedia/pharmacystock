import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { ReplaySaleDispatchContext } from '../offline/replaySaleTransport';

export type PosProduct = { stock_unit?: string; id: string; name: string; generic_name: string | null; brand_name: string | null; sku: string | null };
export type PosBatch = { id: string; product_id: string; lot_number: string; expiry_date: string; selling_price: number | null; status: string };
export type Sale = { idempotency_key?: string; id: string; organization_id: string; branch_id: string; customer_id: string | null; sale_number: string; status: 'COMPLETED'|'PARTIALLY_REFUNDED'|'REFUNDED'|'VOIDED'; subtotal: number; discount_total: number; total_amount: number; currency_code: string; notes: string | null; completed_at: string; created_by: string; created_at: string };
export type SaleItem = { id: string; organization_id: string; sale_id: string; product_id: string; batch_id: string; quantity: number; unit_price: number; line_total: number; inventory_movement_id: string; created_at: string };
export type Payment = { id: string; organization_id: string; branch_id: string; sale_id: string; method: 'CASH'|'CARD'|'MOBILE_MONEY'|'BANK_TRANSFER'|'OTHER'; amount: number; provider: string | null; external_reference: string | null; status: 'RECORDED'|'REVERSED'; created_at: string; tendered_amount?: number | null; change_amount?: number | null };
export type Refund = { idempotency_key?: string; id: string; organization_id: string; branch_id: string; sale_id: string; refund_number: string; reason: string; amount: number; created_at: string };
export type CartLine = { product_id: string; quantity: number };
export type PaymentInput = { method: Payment['method']; amount: number; provider?: string; external_reference?: string };
export type SaleQuote = { total_amount: number; items: { product_id: string; batch_id: string; quantity: number; unit_price: number; line_total: number; expiry_date: string; lot_number?: string }[] };

export type SalesDatabase = { public: { Tables: {
  products: { Row: PosProduct & { organization_id?: string; status?: string }; Insert: never; Update: never; Relationships: [] };
  batches: { Row: PosBatch & { organization_id?: string; branch_id?: string }; Insert: never; Update: never; Relationships: [] };
  sales: { Row: Sale; Insert: never; Update: never; Relationships: [] };
  sale_items: { Row: SaleItem; Insert: never; Update: never; Relationships: [] };
  payments: { Row: Payment; Insert: never; Update: never; Relationships: [] };
  sale_refunds: { Row: Refund; Insert: never; Update: never; Relationships: [] };
}; Views: Record<string, never>; Functions: {
  quote_sale: { Args: { p_organization_id: string; p_branch_id: string; p_lines: CartLine[] }; Returns: SaleQuote };
  complete_sale_with_customer: { Args: { p_organization_id: string; p_branch_id: string; p_sale_number: string; p_lines: CartLine[]; p_payments: PaymentInput[]; p_idempotency_key: string; p_notes?: string | null; p_customer_id?: string | null; p_expected_quote?: SaleQuote; p_cash_tendered?: number | null }; Returns: string };
  refund_sale: { Args: { p_sale_id: string; p_refund_number: string; p_items: { sale_item_id: string; quantity: number }[]; p_idempotency_key: string; p_reason: string }; Returns: string };
}; Enums: Record<string, never>; CompositeTypes: Record<string, never> } };

const db = supabase as unknown as SupabaseClient<SalesDatabase>;

export async function searchPosProducts(organizationId: string, query: string): Promise<PosProduct[]> {
  const { searchProducts } = await import('./catalogReadiness');
  return (await searchProducts(organizationId, query)).items;
}

export async function loadSellableBatches(organizationId: string, branchId: string, productId: string): Promise<PosBatch[]> {
  const { data, error } = await db.from('batches').select('id,product_id,lot_number,expiry_date,selling_price,status').eq('organization_id', organizationId).eq('branch_id', branchId).eq('product_id', productId).eq('status', 'ACTIVE').gte('expiry_date', new Date().toISOString().slice(0,10)).order('expiry_date');
  if (error) throw error;
  return data as PosBatch[];
}

export async function quoteSale(organizationId: string, branchId: string, lines: CartLine[]): Promise<SaleQuote> {
  const { data, error } = await db.rpc('quote_sale', { p_organization_id: organizationId, p_branch_id: branchId, p_lines: lines });
  if (error) throw error;
  const ids = [...new Set(data.items.map(i => i.batch_id))];
  const { data: batches, error: batchError } = await db.from('batches').select('id,lot_number').eq('organization_id', organizationId).eq('branch_id', branchId).in('id', ids);
  if (batchError) throw batchError;
  return { ...data, items: data.items.map(item => ({ ...item, lot_number: batches.find(b => b.id === item.batch_id)?.lot_number })) };
}

export async function completeSale(input: { organizationId: string; branchId: string; saleNumber: string; lines: CartLine[]; payments: PaymentInput[]; idempotencyKey: string; notes?: string; customerId?: string | null; expectedQuote?: SaleQuote; cashTendered?: number | null }, replay?: ReplaySaleDispatchContext): Promise<string> {
  const guarded = replay
    ? (await import('../offline/replaySaleTransport')).createReplaySaleTransport(supabase, replay)
    : undefined;
  const request = (guarded?.client ?? db).rpc('complete_sale_with_customer', { p_organization_id: input.organizationId, p_branch_id: input.branchId, p_sale_number: input.saleNumber, p_lines: input.lines, p_payments: input.payments, p_idempotency_key: input.idempotencyKey, p_notes: input.notes?.trim() || null, p_customer_id: input.customerId ?? null, ...(input.expectedQuote ? { p_expected_quote: input.expectedQuote, p_cash_tendered: input.cashTendered ?? null } : {}) });
  const { data, error } = await request;
  guarded?.throwIfSkipped();
  if (error) throw error;
  return data;
}

export const SALES_PAGE_SIZE = 25;
export async function loadSales(organizationId: string, branchId: string | null, options: { search?: string; date?: string; page?: number; timezone?: string; customerId?: string } = {}): Promise<Sale[]> {
  const { search = '', date = '', page = 0, timezone = 'UTC' } = options;
  if (!Number.isInteger(page) || page < 0) throw new Error('INVALID_PAGE');
  let request = db.from('sales').select('*').eq('organization_id', organizationId).order('completed_at', { ascending: false }).order('id', { ascending: false });
  if (branchId) request = request.eq('branch_id', branchId);
  if (options.customerId) request = request.eq('customer_id', options.customerId);
  const cleaned = search.trim().replace(/[%_\\]/g, '\\$&');
  if (cleaned) request = request.ilike('sale_number', `%${cleaned}%`);
  if (date) {
    const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    request = request.gte('completed_at', `${date} 00:00:00 ${timezone}`).lt('completed_at', `${next.toISOString().slice(0, 10)} 00:00:00 ${timezone}`);
  }
  const { data, error } = await request.range(page * SALES_PAGE_SIZE, (page + 1) * SALES_PAGE_SIZE);
  if (error) throw error;
  return data;
}

export async function loadSaleItems(organizationId: string, saleId: string): Promise<SaleItem[]> {
  const rows: SaleItem[] = [];
  for (let from = 0; ; from += 200) {
    const { data, error } = await db.from('sale_items').select('*').eq('organization_id', organizationId).eq('sale_id', saleId).order('created_at').order('id').range(from, from + 199);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 200) return rows;
  }
}

export async function loadPayments(organizationId: string, saleId: string): Promise<Payment[]> {
  const rows: Payment[] = [];
  for (let from = 0; ; from += 200) {
    const { data, error } = await db.from('payments').select('*').eq('organization_id', organizationId).eq('sale_id', saleId).order('created_at').order('id').range(from, from + 199);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 200) return rows;
  }
}

export async function loadRefunds(organizationId: string, saleId: string): Promise<Refund[]> {
  const rows: Refund[] = [];
  for (let from = 0; ; from += 200) {
    const { data, error } = await db.from('sale_refunds').select('*').eq('organization_id', organizationId).eq('sale_id', saleId).order('created_at').order('id').range(from, from + 199);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 200) return rows;
  }
}

export async function refundSale(input: { saleId: string; refundNumber: string; items: { sale_item_id: string; quantity: number }[]; idempotencyKey: string; reason: string }): Promise<string> {
  const { data, error } = await db.rpc('refund_sale', { p_sale_id: input.saleId, p_refund_number: input.refundNumber, p_items: input.items, p_idempotency_key: input.idempotencyKey, p_reason: input.reason.trim() });
  if (error) throw error;
  return data;
}
