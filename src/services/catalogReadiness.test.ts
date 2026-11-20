import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCatalogProduct, maintainBarcode, pageRange, postOpeningStock, repriceBatch, searchBatches, searchProducts, setProductArchived, updateProduct } from './catalogReadiness';
const mocks = vi.hoisted(() => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const key of ['eq', 'is', 'select', 'update', 'in']) chain[key] = vi.fn(() => chain);
  chain.single = vi.fn(); chain.maybeSingle = vi.fn(); chain.range = vi.fn();
  return { chain, rpc: vi.fn(() => chain), from: vi.fn(() => chain) };
});
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }));
vi.mock('./inventory', () => ({ loadInventoryBalances: vi.fn(async (_org, _branch, rows) => rows) }));

beforeEach(() => { vi.clearAllMocks(); mocks.chain.range!.mockResolvedValue({ data: [], error: null }); mocks.chain.single!.mockResolvedValue({ data: { id: 'product' }, error: null }); mocks.chain.maybeSingle!.mockResolvedValue({ data: { id: 'batch' }, error: null }); });
describe('full catalog pages', () => {
  it('requests a bounded page beyond the old 80/200 product selector caps', async () => {
    mocks.chain.range!.mockResolvedValue({ data: Array.from({ length: 31 }, (_, index) => ({ id: `product-${210 + index}` })), error: null });
    const result = await searchProducts('org', '', 7); expect(mocks.chain.range).toHaveBeenCalledWith(210, 240); expect(result.items[0]?.id).toBe('product-210'); expect(result.items).toHaveLength(30); expect(result.hasMore).toBe(true);
  });
  it('sends a query to the full catalog instead of filtering a capped local list', async () => { await searchProducts('org', 'barcode-9999'); expect(mocks.rpc).toHaveBeenCalledWith('search_catalog_products', { p_organization_id: 'org', p_search: 'barcode-9999', p_status: 'active' }); });
  it('supports a batch page beyond the old 60 limit and keeps empty results empty', async () => { expect(await searchBatches('org', 'branch', 'LOT-999', 5)).toEqual({ items: [], hasMore: false }); expect(mocks.chain.range).toHaveBeenCalledWith(150, 180); expect(mocks.rpc).toHaveBeenCalledWith('search_catalog_batches', { p_organization_id: 'org', p_branch_id: 'branch', p_search: 'LOT-999' }); });
  it('rejects invalid pagination', () => { expect(() => pageRange(-1)).toThrow('INVALID_PAGE'); });
  it('surfaces search errors', async () => { mocks.chain.range!.mockResolvedValue({ data: null, error: new Error('network') }); await expect(searchProducts('org')).rejects.toThrow('network'); });
});
describe('maintenance and opening-stock contracts', () => {
  it('edits product fields in place, retaining its ID and separating package/unit', async () => { await updateProduct('product', { organizationId: 'org', name: ' New name ', sku: 'NEW', packageSize: 'Box of 20', stockUnit: 'tablet' }); expect(mocks.chain.update).toHaveBeenCalledWith(expect.objectContaining({ name: 'New name', sku: 'NEW', package_size: 'Box of 20', stock_unit: 'tablet' })); expect(mocks.chain.eq).toHaveBeenCalledWith('organization_id', 'org'); expect(mocks.chain.eq).toHaveBeenCalledWith('id', 'product'); });
  it('restores the existing product rather than creating a duplicate identity', async () => { await setProductArchived('org', 'product', false); expect(mocks.chain.update).toHaveBeenCalledWith({ status: 'active', archived_at: null }); });
  it('uses transactional barcode maintenance for add/remove/primary', async () => { mocks.rpc.mockResolvedValueOnce({ data: [], error: null } as never); await maintainBarcode('org', 'product', 'ADD', ' 00123 '); expect(mocks.rpc).toHaveBeenCalledWith('maintain_product_barcode', expect.objectContaining({ p_action: 'ADD', p_barcode: '00123' })); });
  it('surfaces barcode conflicts without inventing a second store', async () => { mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error('BARCODE_ALREADY_EXISTS') } as never); await expect(maintainBarcode('org', 'product', 'ADD', '123')).rejects.toThrow('BARCODE_ALREADY_EXISTS'); });
  it('creates product and unit/barcode in one RPC', async () => { mocks.rpc.mockResolvedValueOnce({ data: 'product', error: null } as never); await createCatalogProduct({ organizationId: 'org', name: 'Product', stockUnit: 'box', barcode: '123' }); expect(mocks.rpc).toHaveBeenCalledWith('create_catalog_product', { p_organization_id: 'org', p_product: expect.objectContaining({ stock_unit: 'box', barcode: '123' }) }); });
  it('reprices only selling_price with a compare-and-swap guard', async () => { await repriceBatch({ organizationId: 'org', branchId: 'branch', batchId: 'batch', previousPrice: 2, sellingPrice: 3 }); expect(mocks.chain.update).toHaveBeenCalledWith({ selling_price: 3 }); expect(mocks.chain.eq).toHaveBeenCalledWith('selling_price', 2); });
  it('does not overwrite a concurrently changed price', async () => { mocks.chain.maybeSingle!.mockResolvedValue({ data: null, error: null }); await expect(repriceBatch({ organizationId: 'org', branchId: 'branch', batchId: 'batch', previousPrice: 2, sellingPrice: 3 })).rejects.toThrow('BATCH_PRICE_CHANGED'); });
  it.each([0, -1, NaN])('rejects an invalid new price %s', async (sellingPrice) => { await expect(repriceBatch({ organizationId: 'org', branchId: 'branch', batchId: 'batch', previousPrice: 2, sellingPrice })).rejects.toThrow(); expect(mocks.from).not.toHaveBeenCalled(); });
  it('submits opening stock as one ledger operation with unchanged retry identity', async () => {
    const input = { organizationId: 'org', branchId: 'branch', productId: 'product', lotNumber: 'LOT', expiryDate: '2028-12-31', quantity: 2.5, purchaseCost: 1.2, sellingPrice: 3.5, reason: 'Opening balance', idempotencyKey: 'opening-123' };
    mocks.rpc.mockResolvedValue({ data: 'batch', error: null } as never); await postOpeningStock(input); await postOpeningStock(input);
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]); expect(mocks.rpc).toHaveBeenCalledWith('post_opening_stock', expect.objectContaining({ p_quantity: 2.5, p_purchase_cost: 1.2, p_selling_price: 3.5, p_idempotency_key: 'opening-123', p_reason: 'Opening balance' })); expect(mocks.from).not.toHaveBeenCalled();
  });
});
