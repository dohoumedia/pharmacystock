import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export type PosProduct = { id: string; name: string; generic_name: string | null; brand_name: string | null; sku: string | null };
export type PosBatch = { id: string; product_id: string; lot_number: string; expiry_date: string; selling_price: number | null; status: string };
export type Sale = { id: string; organization_id: string; branch_id: string; sale_number: string; status: 'COMPLETED'|'PARTIALLY_REFUNDED'|'REFUNDED'|'VOIDED'; subtotal: number; discount_total: number; total_amount: number; currency_code: string; notes: string | null; completed_at: string; created_by: string; created_at: string };
export type SaleItem = { id: string; organization_id: string; sale_id: string; product_id: string; batch_id: string; quantity: number; unit_price: number; line_total: number; inventory_movement_id: string; created_at: string };
export type Payment = { id: string; organization_id: string; branch_id: string; sale_id: string; method: 'CASH'|'CARD'|'MOBILE_MONEY'|'BANK_TRANSFER'|'OTHER'; amount: number; provider: string | null; external_reference: string | null; status: 'RECORDED'|'REVERSED'; created_at: string };
export type Refund = { id: string; organization_id: string; branch_id: string; sale_id: string; refund_number: string; reason: string; amount: number; created_at: string };
export type CartLine = { product_id: string; quantity: number };
export type PaymentInput = { method: Payment['method']; amount: number; provider?: string; external_reference?: string };
export type SaleQuote = { total_amount: number; items: { product_id: string; batch_id: string; quantity: number; unit_price: number; line_total: number; expiry_date: string }[] };

type SalesDatabase = { public: { Tables: {
  products: { Row: PosProduct & { organization_id?: string; status?: string }; Insert: never; Update: never; Relationships: [] };
  batches: { Row: PosBatch & { organization_id?: string; branch_id?: string }; Insert: never; Update: never; Relationships: [] };
  sales: { Row: Sale; Insert: never; Update: never; Relationships: [] };
  sale_items: { Row: SaleItem; Insert: never; Update: never; Relationships: [] };
  payments: { Row: Payment; Insert: never; Update: never; Relationships: [] };
  sale_refunds: { Row: Refund; Insert: never; Update: never; Relationships: [] };
}; Views: Record<string, never>; Functions: {
  quote_sale: { Args: { p_organization_id: string; p_branch_id: string; p_lines: CartLine[] }; Returns: SaleQuote };
  complete_sale: { Args: { p_organization_id: string; p_branch_id: string; p_sale_number: string; p_lines: CartLine[]; p_payments: PaymentInput[]; p_idempotency_key: string; p_notes?: string | null }; Returns: string };
  refund_sale: { Args: { p_sale_id: string; p_refund_number: string; p_items: { sale_item_id: string; quantity: number }[]; p_idempotency_key: string; p_reason: string }; Returns: string };
}; Enums: Record<string, never>; CompositeTypes: Record<string, never> } };

const db = supabase as unknown as SupabaseClient<SalesDatabase>;

export async function searchPosProducts(organizationId: string, query: string): Promise<PosProduct[]> {
  const cleaned = query.trim();
  let request = db.from('products').select('id,name,generic_name,brand_name,sku').eq('organization_id', organizationId).eq('status', 'active').limit(30);
  if (cleaned) request = request.or(`name.ilike.%${cleaned}%,generic_name.ilike.%${cleaned}%,brand_name.ilike.%${cleaned}%,sku.ilike.%${cleaned}%`);
  const { data, error } = await request.order('name');
  if (error) throw error;
  return data as PosProduct[];
}

export async function loadSellableBatches(organizationId: string, branchId: string, productId: string): Promise<PosBatch[]> {
  const { data, error } = await db.from('batches').select('id,product_id,lot_number,expiry_date,selling_price,status').eq('organization_id', organizationId).eq('branch_id', branchId).eq('product_id', productId).eq('status', 'ACTIVE').gte('expiry_date', new Date().toISOString().slice(0,10)).order('expiry_date');
  if (error) throw error;
  return data as PosBatch[];
}

export async function quoteSale(organizationId: string, branchId: string, lines: CartLine[]): Promise<SaleQuote> {
  const { data, error } = await db.rpc('quote_sale', { p_organization_id: organizationId, p_branch_id: branchId, p_lines: lines });
  if (error) throw error;
  return data;
}

export async function completeSale(input: { organizationId: string; branchId: string; saleNumber: string; lines: CartLine[]; payments: PaymentInput[]; idempotencyKey: string; notes?: string }): Promise<string> {
  const { data, error } = await db.rpc('complete_sale', { p_organization_id: input.organizationId, p_branch_id: input.branchId, p_sale_number: input.saleNumber, p_lines: input.lines, p_payments: input.payments, p_idempotency_key: input.idempotencyKey, p_notes: input.notes?.trim() || null });
  if (error) throw error;
  return data;
}

export async function loadSales(organizationId: string, branchId: string): Promise<Sale[]> {
  const { data, error } = await db.from('sales').select('*').eq('organization_id', organizationId).eq('branch_id', branchId).order('completed_at', { ascending: false }).limit(100);
  if (error) throw error;
  return data;
}

export async function loadSaleItems(organizationId: string, saleId: string): Promise<SaleItem[]> {
  const { data, error } = await db.from('sale_items').select('*').eq('organization_id', organizationId).eq('sale_id', saleId).order('created_at');
  if (error) throw error;
  return data;
}

export async function loadPayments(organizationId: string, saleId: string): Promise<Payment[]> {
  const { data, error } = await db.from('payments').select('*').eq('organization_id', organizationId).eq('sale_id', saleId).order('created_at');
  if (error) throw error;
  return data;
}

export async function loadRefunds(organizationId: string, saleId: string): Promise<Refund[]> {
  const { data, error } = await db.from('sale_refunds').select('*').eq('organization_id', organizationId).eq('sale_id', saleId).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function refundSale(input: { saleId: string; refundNumber: string; items: { sale_item_id: string; quantity: number }[]; idempotencyKey: string; reason: string }): Promise<string> {
  const { data, error } = await db.rpc('refund_sale', { p_sale_id: input.saleId, p_refund_number: input.refundNumber, p_items: input.items, p_idempotency_key: input.idempotencyKey, p_reason: input.reason.trim() });
  if (error) throw error;
  return data;
}
