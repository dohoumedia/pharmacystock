import { supabase } from '@/lib/supabase';
import { pageRange, productsByIds, searchBatches } from './catalogReadiness';
import { loadInventoryBatch } from './inventoryCompletion';
import { transferDb, loadTransferLines, createStockTransfer, approveStockTransfer, dispatchStockTransfer, receiveStockTransfer, cancelStockTransfer, type StockTransfer } from './transfers';
import { assertTransferOperationScope, receiptValues, transferActionAccepted, transferQuantity, type TransferOperation } from '../domain/transferCompletion';
import { canApplyTransferAction } from '../domain/transferSafety';

export async function searchTransferBatches(organizationId: string, branchId: string, search: string, page: number) {
  // Keep the authoritative paged catalog selector: never filter a capped local batch array.
  return searchBatches(organizationId, branchId, search, page);
}
export async function listTransferWorkspace(organizationId: string, page: number, search = '', status = '') {
  const { from, to } = pageRange(page);
  let query = transferDb.from('stock_transfers').select('*').eq('organization_id', organizationId);
  if (search.trim()) query = query.ilike('transfer_number', `%${search.trim().replace(/[%_]/g, '')}%`);
  if (status) query = query.eq('status', status as StockTransfer['status']);
  const { data, error } = await query.order('created_at', { ascending: false }).order('id').range(from, to);
  if (error) throw error;
  const items = data.slice(0, 30);
  const lines = [];
  // Each transfer's lines are paged, so aggregate quantities cannot silently truncate.
  for (const item of items) lines.push(...await transferLines(organizationId, item.id));
  const products = await productsByIds(organizationId, [...new Set(lines.map((line) => line.product_id))]);
  const contexts = await Promise.all(items.map((item) => readTransferProjection(item.id)));
  const branches = [...new Map(contexts.flatMap((context) => context.branches).map((branch) => [branch.id, branch])).values()];
  const batches = [...new Map(contexts.flatMap((context) => context.batches).map((batch) => [batch.id, batch])).values()];
  return { items, lines, products, branches, batches, hasMore: data.length > 30 };
}
export async function findTransfer(organizationId: string, id: string) {
  const { data, error } = await transferDb.from('stock_transfers').select('*').eq('organization_id', organizationId).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}
async function transferLines(organizationId: string, id: string) {
  const rows: Awaited<ReturnType<typeof loadTransferLines>> = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await transferDb.from('stock_transfer_lines').select('*').eq('organization_id', organizationId).eq('transfer_id', id).order('id').range(offset, offset + 99);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 100) return rows;
  }
}
export async function readTransferProjection(id: string) {
  const { data, error } = await transferDb.rpc('read_stock_transfer_context', { p_transfer_id: id });
  if (error) throw error;
  return data;
}
export async function searchTransferDestinations(organizationId: string, sourceBranchId: string, search: string, page: number) {
  const { from, to } = pageRange(page);
  let query = transferDb.rpc('list_stock_transfer_destinations', { p_organization_id: organizationId, p_source_branch_id: sourceBranchId });
  if (search.trim()) query = query.ilike('name', `%${search.trim().replace(/[%_]/g, '')}%`);
  const { data, error } = await query.range(from, to);
  if (error) throw error;
  return { items: data.slice(0, 30), hasMore: data.length > 30 };
}
export async function loadTransferDetail(organizationId: string, id: string) {
  const transfer = await findTransfer(organizationId, id);
  if (!transfer) throw new Error('TRANSFER_NOT_FOUND');
  const lines = await transferLines(organizationId, id);
  const productIds = [...new Set(lines.map((line) => line.product_id))];
  const [products, projection, barcodeResult] = await Promise.all([
    productsByIds(organizationId, productIds),
    readTransferProjection(id),
    productIds.length ? supabase.from('product_barcodes').select('*').eq('organization_id', organizationId).in('product_id', productIds) : { data: [], error: null },
  ]);
  if (barcodeResult.error) throw barcodeResult.error;
  return { transfer, lines, products, ...projection, barcodes: barcodeResult.data ?? [], historyUnavailable: false };
}
export type TransferDetail = Awaited<ReturnType<typeof loadTransferDetail>>;

export async function findTransferOperation(operation: TransferOperation): Promise<StockTransfer | null> {
  if (operation.transferId || operation.resultId) return findTransfer(operation.organizationId, (operation.resultId || operation.transferId)!);
  const { data, error } = await transferDb.from('stock_transfers').select('*').eq('organization_id', operation.organizationId).eq('idempotency_key', operation.key).maybeSingle();
  if (error) throw error;
  return data;
}
export async function submitTransferOperation(operation: TransferOperation, organizationId: string, branchId: string, beforeDispatch: () => void) {
  assertTransferOperationScope(operation, organizationId, branchId);
  const previous = await findTransferOperation(operation);
  const recover = async (transfer: StockTransfer) => {
    if (operation.action === 'receive') {
      const lines = await transferLines(organizationId, transfer.id);
      if (!operation.receivedLines || lines.length !== operation.receivedLines.length || lines.some((line) => !operation.receivedLines!.some((intended) => intended.line_id === line.id && intended.quantity === Number(line.received_quantity) && (intended.reason || '') === (line.discrepancy_reason || '')))) throw Object.assign(new Error('TRANSFER_RECEIPT_CHANGED'), { transferId: transfer.id });
    }
    return transfer.id;
  };
  if (previous && transferActionAccepted(previous, operation)) return recover(previous);
  // An unkeyed lifecycle RPC with a dropped response is read/recovered only.
  // This also avoids silently accepting another user's different final receipt.
  if (operation.phase !== 'prepared' && operation.action !== 'request') throw new Error('TRANSFER_RESULT_UNCERTAIN');
  if (operation.action === 'request') {
    if (!operation.lines?.length) throw new Error('TRANSFER_LINES_REQUIRED');
    for (const line of operation.lines) {
      const current = await loadInventoryBatch(organizationId, operation.sourceBranchId, line.source_batch_id);
      transferQuantity(String(line.quantity), current, organizationId, operation.sourceBranchId, operation.destinationBranchId);
    }
  } else {
    if (!previous || !canApplyTransferAction(previous.status, operation.action)) throw new Error('TRANSFER_STATE_CHANGED');
    if (operation.action === 'approve') {
      const context = await readTransferProjection(previous.id);
      for (const line of await transferLines(organizationId, previous.id)) {
        const batch = context.batches.find((row) => row.id === line.source_batch_id);
        if (!batch) throw new Error('TRANSFER_SOURCE_BATCH_INVALID');
        transferQuantity(String(line.requested_quantity), { batch, balance: context.balances.find((row) => row.batch_id === batch.id) || null }, organizationId, previous.source_branch_id, previous.destination_branch_id);
      }
    }
    if (operation.action === 'dispatch') {
      const lines = await transferLines(organizationId, previous.id);
      for (const line of lines) transferQuantity(String(line.requested_quantity), await loadInventoryBatch(organizationId, previous.source_branch_id, line.source_batch_id), organizationId, previous.source_branch_id, previous.destination_branch_id);
    }
    if (operation.action === 'receive') {
      const lines = await transferLines(organizationId, previous.id);
      if (!operation.receivedLines || operation.receivedLines.length !== lines.length || new Set(operation.receivedLines.map((line) => line.line_id)).size !== lines.length || operation.receivedLines.some((line) => !lines.some((saved) => saved.id === line.line_id))) throw new Error('TRANSFER_LINES_REQUIRED');
      receiptValues(lines, Object.fromEntries(operation.receivedLines.map((line) => [line.line_id, String(line.quantity)])), Object.fromEntries(operation.receivedLines.map((line) => [line.line_id, line.reason || ''])));
    }
  }
  beforeDispatch();
  try {
    if (operation.action === 'request') return await createStockTransfer({ organizationId, sourceBranchId: operation.sourceBranchId, destinationBranchId: operation.destinationBranchId, transferNumber: operation.transferNumber, lines: operation.lines!, idempotencyKey: operation.key, notes: operation.notes });
    if (operation.action === 'approve') await approveStockTransfer(operation.transferId!);
    if (operation.action === 'dispatch') await dispatchStockTransfer(operation.transferId!);
    if (operation.action === 'cancel') await cancelStockTransfer(operation.transferId!, operation.notes);
    if (operation.action === 'receive') {
      await receiveStockTransfer(operation.transferId!, operation.receivedLines!, operation.notes);
      const accepted = await findTransferOperation(operation);
      if (!accepted || !transferActionAccepted(accepted, operation)) throw new Error('TRANSFER_RESULT_UNCERTAIN');
      return await recover(accepted);
    }
    return operation.transferId!;
  } catch (cause) {
    try { const recovered = await findTransferOperation(operation); if (recovered && transferActionAccepted(recovered, operation)) return await recover(recovered); }
    catch (recoveryError) { if (recoveryError instanceof Error && recoveryError.message === 'TRANSFER_RECEIPT_CHANGED') throw recoveryError; }
    throw cause;
  }
}
