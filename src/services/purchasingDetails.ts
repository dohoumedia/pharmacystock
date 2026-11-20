import { loadBatchStockBalances } from './catalog';
import { supabase } from '@/lib/supabase';
import { purchasingDb as db, loadPurchaseOrderLines, loadSuppliers, type PurchaseOrder, type PurchaseReceipt, type Supplier, type PurchaseOrderLineWithProduct } from './purchasing';

export type ReceiptLineDetail = {
  id: string; purchase_order_line_id: string; batch_id: string; quantity: number; unit_cost: number | null;
  inventory_movement_id: string | null; product_name: string; product_id: string; stock_unit: string;
  lot_number: string; expiry_date: string; current_selling_price: number | null;
};
export type ReceiptDetail = { receipt: PurchaseReceipt; order: PurchaseOrder; supplier: Supplier; orderLines: PurchaseOrderLineWithProduct[]; lines: ReceiptLineDetail[] };

export async function loadOrderDetail(organizationId: string, branchId: string, orderId: string) {
  const { data: order, error } = await db.from('purchase_orders').select('*').eq('organization_id', organizationId).eq('branch_id', branchId).eq('id', orderId).single();
  if (error) throw error;
  const [lines, suppliers, receipts] = await Promise.all([
    loadPurchaseOrderLines(organizationId, orderId, new Map()), loadSuppliers(organizationId),
    db.from('purchase_receipts').select('*').eq('organization_id', organizationId).eq('branch_id', branchId).eq('purchase_order_id', orderId).order('received_at', { ascending: false }),
  ]);
  if (receipts.error) throw receipts.error;
  const supplier = suppliers.find((item) => item.id === order.supplier_id);
  if (!supplier) throw new Error('PURCHASING_DETAIL_UNAVAILABLE');
  return { order: order as PurchaseOrder, supplier, lines, receipts: receipts.data as PurchaseReceipt[] };
}
export type OrderDetail = Awaited<ReturnType<typeof loadOrderDetail>>;

export async function loadReceiptDetail(organizationId: string, branchId: string, receiptId: string): Promise<ReceiptDetail> {
  const { data: receipt, error } = await db.from('purchase_receipts').select('*').eq('organization_id', organizationId).eq('branch_id', branchId).eq('id', receiptId).single();
  if (error) throw error;
  const [detail, rawLines] = await Promise.all([
    loadOrderDetail(organizationId, branchId, receipt.purchase_order_id),
    db.from('purchase_receipt_lines').select('*').eq('organization_id', organizationId).eq('receipt_id', receiptId).order('created_at'),
  ]);
  if (rawLines.error) throw rawLines.error;
  const batchIds = [...new Set(rawLines.data.map((line) => line.batch_id))];
  const { data: batches, error: batchError } = batchIds.length ? await supabase.from('batches').select('*').eq('organization_id', organizationId).eq('branch_id', branchId).in('id', batchIds) : { data: [], error: null };
  if (batchError) throw batchError;
  const lines = rawLines.data.map((line) => {
    const batch = batches.find((item) => item.id === line.batch_id);
    const ordered = detail.lines.find((item) => item.id === line.purchase_order_line_id);
    if (!batch || !ordered || batch.product_id !== ordered.product_id) throw new Error('PURCHASING_DETAIL_UNAVAILABLE');
    return { ...line, quantity: Number(line.quantity), unit_cost: line.unit_cost == null ? null : Number(line.unit_cost), product_id: ordered.product_id, product_name: ordered.product_name, stock_unit: ordered.stock_unit ?? 'unit', lot_number: batch.lot_number, expiry_date: batch.expiry_date, current_selling_price: batch.selling_price == null ? null : Number(batch.selling_price) };
  });
  return { receipt: receipt as PurchaseReceipt, order: detail.order, supplier: detail.supplier, orderLines: detail.lines, lines };
}

/** Server-filtered, paged history; searching is not restricted to a loaded page. */
export async function searchReceipts(organizationId: string, branchId: string, query: string, page: number) {
  let request = db.from('purchase_receipts').select('*').eq('organization_id', organizationId).eq('branch_id', branchId);
  if (query.trim()) request = request.ilike('receipt_number', `%${query.trim().replace(/[%_\\]/g, '')}%`);
  const { data, error } = await request.order('received_at', { ascending: false }).order('id').range(page * 30, page * 30 + 30);
  if (error) throw error;
  return { items: data.slice(0, 30) as PurchaseReceipt[], hasMore: data.length > 30 };
}

export async function loadBatchProvenance(organizationId: string, branchId: string, batchId: string) {
  const { data: batch, error: batchError } = await supabase.from('batches').select('*').eq('organization_id', organizationId).eq('branch_id', branchId).eq('id', batchId).single();
  if (batchError) throw batchError;
  const { data: lines, error } = await db.from('purchase_receipt_lines').select('*').eq('organization_id', organizationId).eq('batch_id', batchId).order('created_at');
  if (error) throw error;
  const [balances, productResult] = await Promise.all([loadBatchStockBalances(organizationId, branchId, [batchId]), supabase.from('products').select('name,stock_unit').eq('organization_id', organizationId).eq('id', batch.product_id).single()]);
  if (productResult.error) throw productResult.error;
  const context = { batch, balance: balances[0] ?? null, product: productResult.data };
  if (!lines.length) return { ...context, receipts: [] };
  const { data: receipts, error: receiptError } = await db.from('purchase_receipts').select('*').eq('organization_id', organizationId).eq('branch_id', branchId).in('id', [...new Set(lines.map((line) => line.receipt_id))]).order('received_at', { ascending: false });
  if (receiptError) throw receiptError;
  const { data: orders, error: orderError } = await db.from('purchase_orders').select('id,po_number,supplier_id').eq('organization_id', organizationId).eq('branch_id', branchId).in('id', [...new Set(receipts.map((receipt) => receipt.purchase_order_id))]);
  if (orderError) throw orderError;
  const suppliers = await loadSuppliers(organizationId);
  return { ...context, receipts: receipts.map((receipt) => {
    const order = orders.find((item) => item.id === receipt.purchase_order_id);
    return { ...receipt, po_number: order?.po_number, supplier_name: suppliers.find((item) => item.id === order?.supplier_id)?.name, quantity: lines.filter((line) => line.receipt_id === receipt.id).reduce((sum, line) => sum + Number(line.quantity), 0) };
  }) };
}
