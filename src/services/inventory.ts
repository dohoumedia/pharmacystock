import { supabase } from '@/lib/supabase';
import type { Database, Json } from '@/types/database';

type InventoryBalance = Database['public']['Views']['inventory_balances']['Row'];
type InventoryMovement = Database['public']['Tables']['inventory_movements']['Row'];
type StockCount = Database['public']['Tables']['inventory_stock_counts']['Row'];
type StockCountLine = Database['public']['Tables']['inventory_stock_count_lines']['Row'];

export type InventoryMovementType =
  | 'PURCHASE_RECEIPT'
  | 'SALE'
  | 'RETURN_IN'
  | 'RETURN_OUT'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'DAMAGE'
  | 'EXPIRY'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'
  | 'COUNT_CORRECTION_IN'
  | 'COUNT_CORRECTION_OUT';

export type InventoryBalanceItem = InventoryBalance & {
  product_name: string;
  lot_number: string;
  expiry_date: string;
};

export async function loadInventoryBalances(organizationId: string, branchId: string): Promise<InventoryBalanceItem[]> {
  const { data: balances, error } = await supabase
    .from('inventory_balances')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('branch_id', branchId)
    .order('last_movement_at', { ascending: false });
  if (error) throw error;
  if (!balances.length) return [];

  const batchIds = balances.map((item) => item.batch_id);
  const productIds = [...new Set(balances.map((item) => item.product_id))];
  const [{ data: batches, error: batchError }, { data: products, error: productError }] = await Promise.all([
    supabase.from('batches').select('id,lot_number,expiry_date').in('id', batchIds),
    supabase.from('products').select('id,name').in('id', productIds),
  ]);
  if (batchError) throw batchError;
  if (productError) throw productError;

  const batchMap = new Map(batches.map((item) => [item.id, item]));
  const productMap = new Map(products.map((item) => [item.id, item.name]));

  return balances.map((item) => ({
    ...item,
    product_name: productMap.get(item.product_id) ?? item.product_id.slice(0, 8),
    lot_number: batchMap.get(item.batch_id)?.lot_number ?? item.batch_id.slice(0, 8),
    expiry_date: batchMap.get(item.batch_id)?.expiry_date ?? '',
  }));
}

export async function loadInventoryMovements(organizationId: string, branchId: string, limit = 100): Promise<InventoryMovement[]> {
  const { data, error } = await supabase
    .from('inventory_movements')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('branch_id', branchId)
    .order('occurred_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function postInventoryMovement(input: {
  organizationId: string;
  branchId: string;
  batchId: string;
  movementType: InventoryMovementType;
  quantityDelta: number;
  reason?: string;
  referenceType?: string;
  referenceId?: string;
  unitCost?: number | null;
  metadata?: Json;
  idempotencyKey?: string;
}): Promise<string> {
  const idempotencyKey = input.idempotencyKey ?? `manual:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase.rpc('post_inventory_movement', {
    p_organization_id: input.organizationId,
    p_branch_id: input.branchId,
    p_batch_id: input.batchId,
    p_movement_type: input.movementType,
    p_quantity_delta: input.quantityDelta,
    p_idempotency_key: idempotencyKey,
    p_reason: input.reason || null,
    p_reference_type: input.referenceType || null,
    p_reference_id: input.referenceId || null,
    p_unit_cost: input.unitCost ?? null,
    p_metadata: input.metadata ?? {},
    p_occurred_at: new Date().toISOString(),
  });
  if (error) throw error;
  return data;
}

export async function createStockCount(input: {
  organizationId: string;
  branchId: string;
  notes?: string;
}): Promise<StockCount> {
  const { data, error } = await supabase
    .from('inventory_stock_counts')
    .insert({ organization_id: input.organizationId, branch_id: input.branchId, notes: input.notes || null })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function upsertStockCountLine(input: {
  stockCountId: string;
  organizationId: string;
  branchId: string;
  batchId: string;
  countedQuantity: number;
}): Promise<StockCountLine> {
  const { data, error } = await supabase
    .from('inventory_stock_count_lines')
    .upsert({
      stock_count_id: input.stockCountId,
      organization_id: input.organizationId,
      branch_id: input.branchId,
      batch_id: input.batchId,
      counted_quantity: input.countedQuantity,
    }, { onConflict: 'stock_count_id,batch_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function completeStockCount(stockCountId: string): Promise<string> {
  const { data, error } = await supabase.rpc('complete_inventory_stock_count', { p_stock_count_id: stockCountId });
  if (error) throw error;
  return data;
}

export async function loadOpenStockCounts(organizationId: string, branchId: string): Promise<StockCount[]> {
  const { data, error } = await supabase
    .from('inventory_stock_counts')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('branch_id', branchId)
    .eq('status', 'OPEN')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export type { InventoryBalance, InventoryMovement, StockCount, StockCountLine };
