import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPurchaseOrder, receivePurchaseOrder, setSupplierActive, updateSupplier } from './purchasing';
import { loadBatchProvenance, loadOrderDetail, loadReceiptDetail, searchReceipts } from './purchasingDetails';
const fixture = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>[]>, calls: [] as { table: string; filters: [string, unknown][]; patch?: unknown; range?: number[] }[], rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: fixture.rpc, from: (table: string) => {
  const call = { table, filters: [] as [string, unknown][], patch: undefined as Record<string, unknown> | undefined, range: undefined as number[] | undefined }; fixture.calls.push(call);
  let singular = false; let values: unknown[] | undefined; let inKey = ''; let query = '';
  const builder = {
    select: () => builder, order: () => builder,
    eq: (key: string, value: unknown) => { call.filters.push([key, value]); return builder; },
    in: (key: string, ids: unknown[]) => { inKey = key; values = ids; return builder; },
    ilike: (_key: string, value: string) => { query = value.replaceAll('%', '').toLowerCase(); return builder; },
    range: (from: number, to: number) => { call.range = [from, to]; return builder; },
    single: () => { singular = true; return builder; },
    update: (patch: Record<string, unknown>) => { call.patch = patch; return builder; },
    then: (resolve: (value: unknown) => unknown) => {
      let rows = (fixture.rows[table] ?? []).filter((row) => call.filters.every(([key, value]) => row[key] === value) && (!values || values.includes(row[inKey])) && (!query || String(row.receipt_number).toLowerCase().includes(query)));
      if (call.patch) rows.forEach((row) => Object.assign(row, call.patch)); if (call.range) rows = rows.slice(call.range[0], call.range[1]! + 1);
      return Promise.resolve(resolve({ data: singular ? rows[0] : rows, error: null }));
    },
  }; return builder;
} } }));
const line = { purchaseOrderLineId: 'line', quantity: 2, lotNumber: 'LOT', expiryDate: '2028-01-01', unitCost: 1, sellingPrice: 2 };
beforeEach(() => {
  fixture.calls.length = 0; fixture.rpc.mockReset(); fixture.rpc.mockResolvedValue({ data: 'saved-id', error: null });
  fixture.rows = {
    suppliers: [{ id: 'supplier', organization_id: 'org', name: 'Supplier', status: 'active', phone: 'old' }],
    purchase_orders: [{ id: 'po', organization_id: 'org', branch_id: 'a', supplier_id: 'supplier', status: 'partially_received', po_number: 'PO1' }],
    purchase_order_lines: [{ id: 'line', organization_id: 'org', purchase_order_id: 'po', product_id: 'product', ordered_quantity: 10, received_quantity: 2 }],
    products: [{ id: 'product', organization_id: 'org', name: 'Product 300', stock_unit: 'tablet' }],
    purchase_receipts: [{ id: 'receipt', organization_id: 'org', branch_id: 'a', purchase_order_id: 'po', receipt_number: 'R1' }],
    purchase_receipt_lines: [{ id: 'receipt-line', organization_id: 'org', receipt_id: 'receipt', purchase_order_line_id: 'line', batch_id: 'batch', quantity: 2, unit_cost: 1, inventory_movement_id: 'movement' }],
    inventory_balances: [{ organization_id: 'org', branch_id: 'a', batch_id: 'batch', on_hand_quantity: 2, reserved_quantity: 0, available_quantity: 2 }],
    batches: [{ id: 'batch', organization_id: 'org', branch_id: 'a', product_id: 'product', lot_number: 'LOT', expiry_date: '2028-01-01', selling_price: 3 }],
  };
});
describe('purchasing service readiness', () => {
  it('edits supplier identity/contact in place without changing historical references', async () => { const originalId = fixture.rows.purchase_orders![0]!.supplier_id; await updateSupplier({ organizationId: 'org', supplierId: 'supplier', name: ' New ', phone: '123', email: 'a@b.invalid', address: 'Road', code: 'S1' }); expect(fixture.rows.suppliers![0]!).toMatchObject({ id: 'supplier', name: 'New', phone: '123', address: 'Road' }); expect(fixture.rows.purchase_orders![0]!.supplier_id).toBe(originalId); expect(fixture.calls[0]!.filters).toEqual([['organization_id', 'org'], ['id', 'supplier']]); });
  it('deactivates and restores without deleting suppliers, orders or receipts', async () => { await setSupplierActive('org', 'supplier', false); expect(fixture.rows.suppliers![0]!.status).toBe('inactive'); expect(fixture.rows.purchase_receipts!).toHaveLength(1); await setSupplierActive('org', 'supplier', true); expect(fixture.rows.suppliers![0]!.status).toBe('active'); });
  it('rejects empty supplier names and invalid PO rows before a write', async () => { await expect(updateSupplier({ organizationId: 'org', supplierId: 'supplier', name: ' ' })).rejects.toThrow('SUPPLIER_NAME_REQUIRED'); await expect(createPurchaseOrder({ organizationId: 'org', branchId: 'a', supplierId: 'supplier', poNumber: 'P1', lines: [{ productId: 'product', quantity: 2 }, { productId: 'product2', quantity: 0 }] })).rejects.toThrow('PURCHASE_ORDER_INVALID_LINE'); expect(fixture.rpc).not.toHaveBeenCalled(); });
  it('reuses exact operation identity after a lost receipt response and after final receipt', async () => { fixture.rpc.mockResolvedValueOnce({ data: null, error: new TypeError('Failed to fetch') }); const input = { purchaseOrderId: 'po', receiptNumber: 'R1', idempotencyKey: 'fixed-key', lines: [line] }; await expect(receivePurchaseOrder(input)).rejects.toThrow('Failed to fetch'); await receivePurchaseOrder(input); expect(fixture.rpc.mock.calls[0]).toEqual(fixture.rpc.mock.calls[1]); expect(fixture.rpc.mock.calls[1]![1].p_idempotency_key).toBe('fixed-key'); });
  it('uses stable order identity on retries', async () => { const input = { organizationId: 'org', branchId: 'a', supplierId: 'supplier', poNumber: ' P1 ', lines: [{ productId: 'product', quantity: 2 }] }; await createPurchaseOrder(input); await createPurchaseOrder(input); expect(fixture.rpc.mock.calls[0]).toEqual(fixture.rpc.mock.calls[1]); });
  it('aggregates supplier, accurate lines and receipts for one branch-bound PO', async () => { const detail = await loadOrderDetail('org', 'a', 'po'); expect(detail.supplier.name).toBe('Supplier'); expect(detail.lines[0]).toMatchObject({ product_name: 'Product 300', stock_unit: 'tablet', ordered_quantity: 10, received_quantity: 2 }); expect(detail.receipts[0]!.id).toBe('receipt'); expect(fixture.calls[0]!.filters).toContainEqual(['branch_id', 'a']); });
  it('drills into the exact receipt/batch/movement and distinguishes historical cost from current price', async () => { const detail = await loadReceiptDetail('org', 'a', 'receipt'); expect(detail.lines[0]).toMatchObject({ quantity: 2, unit_cost: 1, current_selling_price: 3, batch_id: 'batch', lot_number: 'LOT', inventory_movement_id: 'movement' }); expect(detail.order.status).toBe('partially_received'); });
  it('rejects incompatible receipt/batch product identity instead of presenting fabricated detail', async () => { fixture.rows.batches![0]!.product_id = 'different'; await expect(loadReceiptDetail('org', 'a', 'receipt')).rejects.toThrow('PURCHASING_DETAIL_UNAVAILABLE'); });
  it('resolves batch provenance through existing receipt lines and PO references', async () => { const detail = await loadBatchProvenance('org', 'a', 'batch'); expect(detail.receipts[0]).toMatchObject({ id: 'receipt', po_number: 'PO1', supplier_name: 'Supplier', quantity: 2 }); });
  it('pages and searches history on the server, with one lookahead row', async () => { fixture.rows.purchase_receipts! = Array.from({ length: 65 }, (_, i) => ({ ...fixture.rows.purchase_receipts![0]!, id: `receipt-${i}`, receipt_number: `REF-${i}` })); const page = await searchReceipts('org', 'a', 'REF', 1); expect(page.items).toHaveLength(30); expect(page.items[0]!.id).toBe('receipt-30'); expect(page.hasMore).toBe(true); expect(fixture.calls[0]!.range).toEqual([30, 60]); });
});
