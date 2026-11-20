import { customerById } from './customerWorkflow';
import type { Customer } from './coreCompletion';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { barcodeProductIds } from '../domain/posCompletion';
import { loadSales, SALES_PAGE_SIZE, loadPayments, loadRefunds, loadSaleItems, type Sale, type SaleItem, type PosProduct, type PosBatch, type Payment, type Refund, type SalesDatabase } from './sales';

export type RefundItem = { id: string; refund_id: string; sale_item_id: string; batch_id: string; quantity: number; amount: number; inventory_movement_id: string | null };
type CompletionDatabase = { public: Omit<SalesDatabase['public'], 'Tables'> & { Tables: SalesDatabase['public']['Tables'] & {
  product_barcodes: { Row: { organization_id: string; product_id: string; barcode: string }; Insert: never; Update: never; Relationships: [] };
  sale_refund_items: { Row: RefundItem & { organization_id: string }; Insert: never; Update: never; Relationships: [] };
  profiles: { Row: { user_id: string; display_name: string | null }; Insert: never; Update: never; Relationships: [] };
} } };
const db = supabase as unknown as SupabaseClient<CompletionDatabase>;
export async function resolvePosBarcode(organizationId: string, barcode: string): Promise<PosProduct> {
  const { data, error } = await db.from('product_barcodes').select('product_id').eq('organization_id', organizationId).eq('barcode', barcode.trim()).limit(2);
  if (error) throw error;
  const ids = barcodeProductIds(data);
  if (!ids.length) throw new Error('POS_BARCODE_UNKNOWN');
  if (ids.length !== 1 || !ids[0]) throw new Error('POS_BARCODE_AMBIGUOUS');
  const { data: product, error: productError } = await db.from('products').select('id,name,generic_name,brand_name,sku,stock_unit').eq('organization_id', organizationId).eq('id', ids[0]).eq('status', 'active').maybeSingle();
  if (productError) throw productError;
  if (!product) throw new Error('POS_BARCODE_UNKNOWN');
  return product;
}
export { SALES_PAGE_SIZE } from './sales';
export async function salesPage(organizationId: string, branchId: string | null, search = '', date = '', page = 0, timezone = 'UTC', customerId?: string) {
  const data = await loadSales(organizationId, branchId, { search, date, page, timezone, customerId });
  return { items: data.slice(0, SALES_PAGE_SIZE), hasMore: data.length > SALES_PAGE_SIZE };
}
export async function saleByIdentity(organizationId: string, branchId: string, identity: string) {
  const { data, error } = await db.from('sales').select('*').eq('organization_id', organizationId).eq('branch_id', branchId).eq('idempotency_key', identity).maybeSingle();
  if (error) throw error;
  return data;
}
export type SaleDetailData = { sale: Sale; items: SaleItem[]; payments: Payment[]; refunds: Refund[]; refundItems: RefundItem[]; products: PosProduct[]; batches: PosBatch[]; cashier: string; customer?: Pick<Customer, 'id' | 'full_name' | 'status'> | null };
async function allRows<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 200) { const { data, error } = await read(from, from + 199); if (error) throw error; rows.push(...(data ?? [])); if (!data || data.length < 200) return rows; }
}
export async function saleDetail(organizationId: string, branchId: string, saleId: string): Promise<SaleDetailData> {
  const { data: sale, error } = await db.from('sales').select('*').eq('organization_id', organizationId).eq('branch_id', branchId).eq('id', saleId).single(); if (error) throw error;
  const [items, payments, refunds] = await Promise.all([loadSaleItems(organizationId, saleId), loadPayments(organizationId, saleId), loadRefunds(organizationId, saleId)]);
  const [refundItems, products, batches, profile, customer] = await Promise.all([
    refunds.length ? allRows((from, to) => db.from('sale_refund_items').select('*').eq('organization_id', organizationId).in('refund_id', refunds.map(r => r.id)).order('id').range(from, to)) : Promise.resolve([]),
    items.length ? allRows((from, to) => db.from('products').select('id,name,generic_name,brand_name,sku,stock_unit').eq('organization_id', organizationId).in('id', [...new Set(items.map(i => i.product_id))]).order('id').range(from, to)) : Promise.resolve([]),
    items.length ? allRows((from, to) => db.from('batches').select('id,product_id,lot_number,expiry_date,selling_price,status').eq('organization_id', organizationId).eq('branch_id', branchId).in('id', [...new Set(items.map(i => i.batch_id))]).order('id').range(from, to)) : Promise.resolve([]),
    db.from('profiles').select('display_name').eq('user_id', sale.created_by).maybeSingle(),
    // Customer availability must never prevent reading/refunding the original sale.
    sale.customer_id ? customerById(organizationId, sale.customer_id).catch(() => null) : Promise.resolve(null),
  ]);
  if (profile.error) throw profile.error;
  return { sale, items, payments, refunds, refundItems, products, batches, customer: customer ? { id: customer.id, full_name: customer.full_name, status: customer.status } : null, cashier: profile.data?.display_name ?? sale.created_by };
}
export async function refundByIdentity(organizationId: string, saleId: string, key: string) {
  const { data, error } = await db.from('sale_refunds').select('*').eq('organization_id', organizationId).eq('sale_id', saleId).eq('idempotency_key', key).maybeSingle(); if (error) throw error; return data;
}
