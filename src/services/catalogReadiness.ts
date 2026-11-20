import { supabase } from '@/lib/supabase';
import type { Batch, Barcode, CreateProductInput, Product } from './catalog';
import { loadInventoryBalances } from './inventory';
import type { StockUnit } from '@/domain/stockUnits';

export const CATALOG_PAGE_SIZE = 30;
export type Page<T> = { items: T[]; hasMore: boolean };
export function pageRange(page: number) {
  if (!Number.isInteger(page) || page < 0) throw new Error('INVALID_PAGE');
  return { from: page * CATALOG_PAGE_SIZE, to: (page + 1) * CATALOG_PAGE_SIZE };
}
function pageResult<T>(rows: T[]): Page<T> {
  return { items: rows.slice(0, CATALOG_PAGE_SIZE), hasMore: rows.length > CATALOG_PAGE_SIZE };
}
export async function searchProducts(organizationId: string, search = '', page = 0, status: string | null = 'active'): Promise<Page<Product>> {
  const { from, to } = pageRange(page);
  const { data, error } = await supabase.rpc('search_catalog_products', { p_organization_id: organizationId, p_search: search.trim(), p_status: status }).range(from, to);
  if (error) throw error;
  return pageResult(data);
}
export type BatchChoice = Batch & { product_name: string; stock_unit?: string };
export async function searchBatches(organizationId: string, branchId: string, search = '', page = 0): Promise<Page<BatchChoice>> {
  const { from, to } = pageRange(page);
  const { data, error } = await supabase.rpc('search_catalog_batches', { p_organization_id: organizationId, p_branch_id: branchId, p_search: search.trim() }).range(from, to);
  if (error) throw error;
  const result = pageResult(data);
  const products = new Map((await productsByIds(organizationId, result.items.map((batch) => batch.product_id))).map((product) => [product.id, product]));
  return { ...result, items: result.items.map((batch) => ({ ...batch, product_name: products.get(batch.product_id)?.name ?? batch.product_id, stock_unit: products.get(batch.product_id)?.stock_unit })) };
}
export async function productsByIds(organizationId: string, ids: string[]): Promise<Product[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase.from('products').select('*').eq('organization_id', organizationId).in('id', [...new Set(ids)]);
  if (error) throw error;
  return data;
}
export type ProductMaintenanceInput = Omit<CreateProductInput, 'barcode'> & { stockUnit: StockUnit };
function productFields(input: ProductMaintenanceInput) {
  const nullable = (value?: string) => value?.trim() || null;
  if (!input.name.trim()) throw new Error('PRODUCT_NAME_REQUIRED');
  return { name: input.name.trim(), generic_name: nullable(input.genericName), brand_name: nullable(input.brandName), strength: nullable(input.strength), dosage_form: nullable(input.dosageForm), package_size: nullable(input.packageSize), sku: nullable(input.sku), category_id: input.categoryId ?? null, manufacturer_id: input.manufacturerId ?? null, stock_unit: input.stockUnit };
}
export async function createCatalogProduct(input: ProductMaintenanceInput & { barcode?: string }): Promise<string> {
  const { data, error } = await supabase.rpc('create_catalog_product', { p_organization_id: input.organizationId, p_product: { ...productFields(input), barcode: input.barcode?.trim() || null } });
  if (error) throw error;
  return data;
}
export async function updateProduct(productId: string, input: ProductMaintenanceInput): Promise<Product> {
  const { data, error } = await supabase.from('products').update(productFields(input)).eq('organization_id', input.organizationId).eq('id', productId).select('*').single();
  if (error) throw error;
  return data;
}
export async function setProductArchived(organizationId: string, productId: string, archived: boolean): Promise<Product> {
  const { data, error } = await supabase.from('products').update({ status: archived ? 'archived' : 'active', archived_at: archived ? new Date().toISOString() : null }).eq('organization_id', organizationId).eq('id', productId).select('*').single();
  if (error) throw error;
  return data;
}
export async function maintainBarcode(organizationId: string, productId: string, action: 'ADD' | 'REMOVE' | 'PRIMARY', barcode?: string, barcodeId?: string): Promise<Barcode[]> {
  const { data, error } = await supabase.rpc('maintain_product_barcode', { p_organization_id: organizationId, p_product_id: productId, p_action: action, p_barcode: barcode?.trim() || null, p_barcode_id: barcodeId ?? null });
  if (error) throw error;
  return data;
}
export async function repriceBatch(input: { organizationId: string; branchId: string; batchId: string; previousPrice: number | null; sellingPrice: number }): Promise<Batch> {
  if (!Number.isFinite(input.sellingPrice) || input.sellingPrice <= 0) throw new Error('INVALID_BATCH_SELLING_PRICE');
  let query = supabase.from('batches').update({ selling_price: input.sellingPrice }).eq('organization_id', input.organizationId).eq('branch_id', input.branchId).eq('id', input.batchId);
  query = input.previousPrice === null ? query.is('selling_price', null) : query.eq('selling_price', input.previousPrice);
  const { data, error } = await query.select('*').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('BATCH_PRICE_CHANGED');
  return data;
}
export type OpeningStockInput = { organizationId: string; branchId: string; productId: string; lotNumber: string; expiryDate: string; quantity: number; purchaseCost: number | null; sellingPrice: number; reason: string; idempotencyKey: string };
export async function postOpeningStock(input: OpeningStockInput): Promise<string> {
  const { data, error } = await supabase.rpc('post_opening_stock', { p_organization_id: input.organizationId, p_branch_id: input.branchId, p_product_id: input.productId, p_lot_number: input.lotNumber.trim(), p_expiry_date: input.expiryDate, p_quantity: input.quantity, p_purchase_cost: input.purchaseCost, p_selling_price: input.sellingPrice, p_reason: input.reason.trim(), p_idempotency_key: input.idempotencyKey });
  if (error) throw error;
  return data;
}
export async function searchInventoryStock(organizationId: string, branchId: string, search = '', page = 0) {
  const { from, to } = pageRange(page);
  const { data, error } = await supabase.rpc('search_inventory_stock', { p_organization_id: organizationId, p_branch_id: branchId, p_search: search.trim() }).range(from, to);
  if (error) throw error;
  const result = pageResult(data);
  return { ...result, items: await loadInventoryBalances(organizationId, branchId, result.items) };
}
