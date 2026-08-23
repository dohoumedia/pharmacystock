import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

type Product = Database['public']['Tables']['products']['Row'];
type Category = Database['public']['Tables']['categories']['Row'];
type Manufacturer = Database['public']['Tables']['manufacturers']['Row'];
type Barcode = Database['public']['Tables']['product_barcodes']['Row'];
type Batch = Database['public']['Tables']['batches']['Row'];

export type ProductListItem = Product & { primaryBarcode: string | null };

function cleanSearch(value: string) {
  return value.trim().replace(/[,%()]/g, ' ');
}

export async function loadProducts(organizationId: string, search = ''): Promise<ProductListItem[]> {
  const cleaned = cleanSearch(search);
  let query = supabase
    .from('products')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .order('name')
    .limit(200);

  if (cleaned) {
    const pattern = `%${cleaned}%`;
    query = query.or(`name.ilike.${pattern},generic_name.ilike.${pattern},brand_name.ilike.${pattern},sku.ilike.${pattern}`);
  }

  const { data: products, error } = await query;
  if (error) throw error;
  if (products.length === 0) return [];

  const productIds = products.map((product) => product.id);
  const { data: barcodes, error: barcodeError } = await supabase
    .from('product_barcodes')
    .select('*')
    .in('product_id', productIds)
    .order('is_primary', { ascending: false });
  if (barcodeError) throw barcodeError;

  const primaryBarcode = new Map<string, string>();
  for (const barcode of barcodes) {
    if (!primaryBarcode.has(barcode.product_id) || barcode.is_primary) {
      primaryBarcode.set(barcode.product_id, barcode.barcode);
    }
  }

  return products.map((product) => ({
    ...product,
    primaryBarcode: primaryBarcode.get(product.id) ?? null,
  }));
}

export async function findProductByBarcode(organizationId: string, barcode: string): Promise<ProductListItem | null> {
  const value = barcode.trim();
  if (!value) return null;

  const { data: barcodeRow, error } = await supabase
    .from('product_barcodes')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('barcode', value)
    .maybeSingle();
  if (error) throw error;
  if (!barcodeRow) return null;

  const { data: product, error: productError } = await supabase
    .from('products')
    .select('*')
    .eq('id', barcodeRow.product_id)
    .eq('status', 'active')
    .maybeSingle();
  if (productError) throw productError;
  return product ? { ...product, primaryBarcode: barcodeRow.barcode } : null;
}

export async function loadCategories(organizationId: string): Promise<Category[]> {
  const { data, error } = await supabase.from('categories').select('*').eq('organization_id', organizationId).eq('status', 'active').order('name');
  if (error) throw error;
  return data;
}

export async function loadManufacturers(organizationId: string): Promise<Manufacturer[]> {
  const { data, error } = await supabase.from('manufacturers').select('*').eq('organization_id', organizationId).eq('status', 'active').order('name');
  if (error) throw error;
  return data;
}

export async function createCategory(organizationId: string, name: string): Promise<Category> {
  const { data, error } = await supabase.from('categories').insert({ organization_id: organizationId, name: name.trim() }).select('*').single();
  if (error) throw error;
  return data;
}

export async function createManufacturer(organizationId: string, name: string): Promise<Manufacturer> {
  const { data, error } = await supabase.from('manufacturers').insert({ organization_id: organizationId, name: name.trim() }).select('*').single();
  if (error) throw error;
  return data;
}

export type CreateProductInput = {
  organizationId: string;
  name: string;
  genericName?: string;
  brandName?: string;
  strength?: string;
  dosageForm?: string;
  packageSize?: string;
  sku?: string;
  categoryId?: string | null;
  manufacturerId?: string | null;
  barcode?: string;
};

export async function createProduct(input: CreateProductInput): Promise<string> {
  if (input.barcode?.trim()) {
    const existing = await findProductByBarcode(input.organizationId, input.barcode);
    if (existing) throw new Error('BARCODE_ALREADY_EXISTS');
  }

  const { data, error } = await supabase.rpc('create_product_with_barcode', {
    p_organization_id: input.organizationId,
    p_name: input.name,
    p_generic_name: input.genericName || null,
    p_brand_name: input.brandName || null,
    p_strength: input.strength || null,
    p_dosage_form: input.dosageForm || null,
    p_package_size: input.packageSize || null,
    p_sku: input.sku || null,
    p_category_id: input.categoryId ?? null,
    p_manufacturer_id: input.manufacturerId ?? null,
    p_barcode: input.barcode || null,
  });
  if (error) throw error;
  return data;
}

export async function archiveProduct(productId: string) {
  const { error } = await supabase
    .from('products')
    .update({ status: 'archived', archived_at: new Date().toISOString() })
    .eq('id', productId);
  if (error) throw error;
}

export async function loadBatches(organizationId: string, branchId?: string | null): Promise<Batch[]> {
  let query = supabase
    .from('batches')
    .select('*')
    .eq('organization_id', organizationId)
    .order('expiry_date');
  if (branchId) query = query.eq('branch_id', branchId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createBatch(input: Database['public']['Tables']['batches']['Insert']): Promise<Batch> {
  const { data, error } = await supabase.from('batches').insert(input).select('*').single();
  if (error) throw error;
  return data;
}

export async function loadBarcodes(productId: string): Promise<Barcode[]> {
  const { data, error } = await supabase.from('product_barcodes').select('*').eq('product_id', productId).order('is_primary', { ascending: false });
  if (error) throw error;
  return data;
}

export type { Product, Category, Manufacturer, Barcode, Batch };
