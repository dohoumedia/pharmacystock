import { supabase } from '@/lib/supabase';
import { completeStockCount, createStockCount, postInventoryMovement, upsertStockCountLine, type InventoryBalance, type InventoryMovement, type StockCountLine } from './inventory';
import { productsByIds, pageRange, type BatchChoice } from './catalogReadiness';
import { adjustmentValues, assertCountScope, assertInventoryScope, countValues, type AdjustmentRequest, type CountDraft } from '../domain/inventoryCompletion';

export async function loadInventoryBatch(organizationId: string, branchId: string, batchId: string) {
  const { data: batch, error } = await supabase.from('batches').select('*').eq('organization_id', organizationId).eq('branch_id', branchId).eq('id', batchId).single();
  if (error) throw error;
  if (!batch) throw new Error('INVENTORY_BATCH_INVALID');
  const [product] = await productsByIds(organizationId, [batch.product_id]);
  if (!product) throw new Error('INVENTORY_BATCH_INVALID');
  const { data: balance, error: balanceError } = await supabase.from('inventory_balances').select('*').eq('organization_id', organizationId).eq('branch_id', branchId).eq('batch_id', batchId).maybeSingle();
  if (balanceError) throw balanceError;
  return { batch: { ...batch, product_name: product.name, stock_unit: product.stock_unit } as BatchChoice, balance: balance as InventoryBalance | null };
}
export async function findInventoryMovement(organizationId: string, branchId: string, key: string) {
  const { data, error } = await supabase.from('inventory_movements').select('*').eq('organization_id', organizationId).eq('branch_id', branchId).eq('idempotency_key', key).maybeSingle();
  if (error) throw error;
  return data;
}
export async function submitInventoryAdjustment(request: AdjustmentRequest, organizationId: string, branchId: string) {
  assertInventoryScope(request, organizationId, branchId);
  // Recovery comes before fresh-stock validation: a previously accepted decrease may now exhaust stock.
  const previous = await findInventoryMovement(organizationId, branchId, request.idempotencyKey);
  if (previous) return previous.id;
  const current = await loadInventoryBatch(organizationId, branchId, request.batch.id);
  adjustmentValues(String(Math.abs(request.quantityDelta)), request.quantityDelta > 0 ? 'IN' : 'OUT', request.reason, current.batch, current.balance, organizationId, branchId);
  return postInventoryMovement({ organizationId, branchId, batchId: request.batch.id, movementType: request.quantityDelta > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT', quantityDelta: request.quantityDelta, reason: request.reason, referenceType: 'MANUAL_ADJUSTMENT', referenceId: request.reference || request.idempotencyKey, idempotencyKey: request.idempotencyKey, occurredAt: request.occurredAt, metadata: { observed_on_hand: request.observedOnHand } });
}
export async function findStockCount(organizationId: string, branchId: string, id: string) {
  const { data, error } = await supabase.from('inventory_stock_counts').select('*').eq('organization_id', organizationId).eq('branch_id', branchId).eq('id', id).maybeSingle();
  if (error) throw error;
  if (data) assertCountScope(data, organizationId, branchId);
  return data;
}
export async function ensureStockCount(draft: CountDraft) {
  const existing = await findStockCount(draft.organizationId, draft.branchId, draft.id);
  if (existing) return existing;
  try { return await createStockCount({ id: draft.id, organizationId: draft.organizationId, branchId: draft.branchId }); }
  catch (cause) {
    // A concurrent retry or dropped create response must recover the same primary key.
    const recovered = await findStockCount(draft.organizationId, draft.branchId, draft.id);
    if (recovered) return recovered;
    throw cause;
  }
}
export async function saveCountDraft(draft: CountDraft) {
  const values = countValues(draft);
  const count = await ensureStockCount(draft);
  if (count.status !== 'OPEN') throw new Error('STOCK_COUNT_NOT_OPEN');
  for (const line of values) await upsertStockCountLine({ stockCountId: draft.id, organizationId: draft.organizationId, branchId: draft.branchId, ...line });
  return count;
}
export async function reconcileInventoryCount(draft: CountDraft) {
  countValues(draft);
  const count = await findStockCount(draft.organizationId, draft.branchId, draft.id);
  if (!count) throw new Error('STOCK_COUNT_NOT_FOUND');
  if (count.status === 'COMPLETED') return count.id;
  if (count.status !== 'OPEN') throw new Error('STOCK_COUNT_NOT_OPEN');
  // Verify saved quantities before posting; never rewrite lines during an uncertain reconcile retry.
  const lines = await loadCountLines(draft.organizationId, draft.branchId, draft.id);
  const values = countValues(draft);
  if (lines.length !== values.length || values.some((value) => !lines.some((line) => line.batch_id === value.batchId && Number(line.counted_quantity) === value.countedQuantity))) throw new Error('INVENTORY_COUNT_CHANGED');
  try { return await completeStockCount(draft.id); }
  catch (cause) {
    const recovered = await findStockCount(draft.organizationId, draft.branchId, draft.id);
    if (recovered?.status === 'COMPLETED') return recovered.id;
    throw cause;
  }
}
export async function listStockCounts(organizationId: string, branchId: string, page = 0) {
  const { from, to } = pageRange(page);
  const { data, error } = await supabase.from('inventory_stock_counts').select('*').eq('organization_id', organizationId).eq('branch_id', branchId).order('created_at', { ascending: false }).order('id').range(from, to);
  if (error) throw error;
  return { items: data.slice(0, 30), hasMore: data.length > 30 };
}
export async function loadCountLines(organizationId: string, branchId: string, id: string) {
  const rows: StockCountLine[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await supabase.from('inventory_stock_count_lines').select('*').eq('organization_id', organizationId).eq('branch_id', branchId).eq('stock_count_id', id).order('id').range(offset, offset + 199);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 200) return rows;
  }
}
export async function loadCountDetail(organizationId: string, branchId: string, id: string) {
  const count = await findStockCount(organizationId, branchId, id);
  if (!count) throw new Error('STOCK_COUNT_NOT_FOUND');
  const lines = await loadCountLines(organizationId, branchId, id);
  const entries = await Promise.all(lines.map(async (line) => {
    const { batch, balance } = await loadInventoryBatch(organizationId, branchId, line.batch_id);
    return { batch, raw: String(line.counted_quantity), expected: count.status === 'COMPLETED' ? Number(line.expected_quantity) : balance ? Number(balance.on_hand_quantity) : null };
  }));
  const movements: InventoryMovement[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await supabase.from('inventory_movements').select('*').eq('organization_id', organizationId).eq('branch_id', branchId).eq('reference_type', 'STOCK_COUNT').eq('reference_id', id).order('id').range(offset, offset + 199);
    if (error) throw error;
    movements.push(...data);
    if (data.length < 200) break;
  }
  return { count, entries, movements };
}
