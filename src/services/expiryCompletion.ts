import { supabase } from '@/lib/supabase';
import { productsByIds } from './catalogReadiness';
import { expiryDb, disposeBatch, returnBatchToSupplier, recordExpiryAction, loadExpiryRisk, loadExpiryAlerts, loadExpiryActions, loadExpiryPolicy, refreshExpiryAlerts, type ExpiryAction } from './expiry';
import { loadInventoryBatch, findInventoryMovement } from './inventoryCompletion';
import { loadBatchProvenance } from './purchasingDetails';
import { assertInventoryScope } from '../domain/inventoryCompletion';
import { expiryActionQuantity, expiryRequestReason, isStockRemoval, type ExpiryRequest } from '../domain/expiryCompletion';

export async function loadExpiryWorkspace(organizationId: string, branchId: string) {
  await refreshExpiryAlerts(organizationId, branchId);
  const policy = await loadExpiryPolicy(organizationId);
  const [risk, alerts, actions] = await Promise.all([loadExpiryRisk(organizationId, branchId, policy?.thresholds_days), loadExpiryAlerts(organizationId, branchId), loadExpiryActions(organizationId, branchId)]);
  return { risk, alerts, actions, policy };
}
export async function findExpiryResult(request: ExpiryRequest): Promise<ExpiryAction | null> {
  let query = expiryDb.from('expiry_actions').select('*').eq('organization_id', request.organizationId).eq('branch_id', request.branchId).eq('batch_id', request.batch.id).eq('action_type', request.action);
  query = isStockRemoval(request.action) ? query.contains('metadata', { idempotency_key: request.idempotencyKey }) : query.eq('reason', expiryRequestReason(request));
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}
export async function submitExpiryRequest(request: ExpiryRequest, organizationId: string, branchId: string, beforeDispatch: () => void) {
  assertInventoryScope(request, organizationId, branchId);
  const accepted = await findExpiryResult(request);
  if (accepted) return accepted.id;
  // Status RPCs lack server retry keys. An ambiguous status result is read/recovered only.
  if (!isStockRemoval(request.action) && request.phase !== 'prepared') throw new Error('EXPIRY_STATUS_UNCERTAIN');
  if (isStockRemoval(request.action)) {
    const movement = await findInventoryMovement(organizationId, branchId, request.idempotencyKey);
    if (movement) throw new Error('EXPIRY_HISTORY_INCOMPLETE');
  }
  const current = await loadInventoryBatch(organizationId, branchId, request.batch.id);
  expiryActionQuantity(request.action, String(request.quantity ?? ''), request.reason, current.batch, current.balance, organizationId, branchId);
  if (request.action === 'DISPOSE' && Number(current.balance!.on_hand_quantity) !== request.observedOnHand) throw new Error('EXPIRY_STOCK_CHANGED');
  const reason = expiryRequestReason(request);
  beforeDispatch(); // Persist dispatch uncertainty before issuing the mutation.
  try {
    if (request.action === 'DISPOSE') return await disposeBatch(request.batch.id, request.idempotencyKey, reason);
    if (request.action === 'SUPPLIER_RETURN') return await returnBatchToSupplier(request.batch.id, request.idempotencyKey, request.quantity!, reason);
    return await recordExpiryAction(request.batch.id, request.action, reason);
  } catch (cause) {
    // Another exact retry can win while this request is in flight. Recover its accepted history.
    try { const recovered = await findExpiryResult(request); if (recovered) return recovered.id; } catch { /* Keep the original uncertainty. */ }
    throw cause;
  }
}
export async function loadAffectedLot(organizationId: string, productId: string, lot: string) {
  const rows = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase.from('batches').select('*').eq('organization_id', organizationId).eq('product_id', productId).eq('lot_number', lot).order('branch_id').order('id').range(offset, offset + 99);
    if (error) throw error;
    rows.push(...await Promise.all(data.map((batch) => loadInventoryBatch(organizationId, batch.branch_id, batch.id))));
    if (data.length < 100) return rows;
  }
}
export async function loadExpiryHistory(organizationId: string, branchId: string, page: number, batchId?: string) {
  let query = expiryDb.from('expiry_actions').select('*').eq('organization_id', organizationId).eq('branch_id', branchId);
  if (batchId) query = query.eq('batch_id', batchId);
  const { data, error } = await query.order('created_at', { ascending: false }).order('id').range(page * 30, page * 30 + 30);
  if (error) throw error;
  const actions = data.slice(0, 30);
  const ids = [...new Set(actions.map((action) => action.batch_id))];
  const { data: batches, error: batchError } = ids.length ? await supabase.from('batches').select('*').eq('organization_id', organizationId).eq('branch_id', branchId).in('id', ids) : { data: [], error: null };
  if (batchError) throw batchError;
  const products = new Map((await productsByIds(organizationId, batches.map((batch) => batch.product_id))).map((product) => [product.id, product]));
  return { items: actions.map((action) => { const batch = batches.find((row) => row.id === action.batch_id); return { action, productName: products.get(batch?.product_id ?? '')?.name, lot: batch?.lot_number }; }), hasMore: data.length > 30 };
}
export async function loadExpiryActionDetail(organizationId: string, branchId: string, action: ExpiryAction) {
  assertInventoryScope({ organizationId: action.organization_id, branchId: action.branch_id }, organizationId, branchId);
  const current = await loadInventoryBatch(organizationId, branchId, action.batch_id);
  const metadata = action.metadata as Record<string, unknown> | null;
  const key = typeof metadata?.idempotency_key === 'string' ? metadata.idempotency_key : null;
  const movement = key ? await findInventoryMovement(organizationId, branchId, key) : null;
  return { ...current, action, movement };
}
export async function loadExpirySuppliers(organizationId: string, branchId: string, batchId: string) {
  const context = await loadBatchProvenance(organizationId, branchId, batchId);
  return [...new Set(context.receipts.map((receipt) => receipt.supplier_name).filter((name): name is string => Boolean(name)))];
}
