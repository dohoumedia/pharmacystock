import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvePosBarcode, saleByIdentity, salesPage, refundByIdentity } from './posCompletion';
import { completeSale, searchPosProducts, quoteSale } from './sales';
const mocks = vi.hoisted(() => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of ['select', 'eq', 'ilike', 'gte', 'lt', 'in', 'order']) chain[name] = vi.fn(() => chain);
  chain.limit = vi.fn(); chain.range = vi.fn(); chain.maybeSingle = vi.fn();
  return { chain, from: vi.fn(() => chain), rpc: vi.fn() };
});
vi.mock('../lib/supabase', () => ({ supabase: mocks }));
vi.mock('./catalogReadiness', () => ({ searchProducts: vi.fn(async () => ({ items: [{ id: 'catalog-product' }] })) }));
beforeEach(() => { vi.clearAllMocks(); mocks.chain.limit!.mockResolvedValue({ data: [], error: null }); mocks.chain.range!.mockResolvedValue({ data: [], error: null }); mocks.chain.maybeSingle!.mockResolvedValue({ data: null, error: null }); mocks.rpc.mockResolvedValue({ data: 'sale-id', error: null }); });
describe('existing lookup and branch-scoped history', () => {
  it('uses the shared catalog search rather than a parallel text search', async () => expect(await searchPosProducts('org', 'sku')).toEqual([{ id: 'catalog-product' }]));
  it('finds any barcode linked to the existing product', async () => { mocks.chain.limit!.mockResolvedValue({ data: [{ product_id: 'p' }], error: null }); mocks.chain.maybeSingle!.mockResolvedValue({ data: { id: 'p', name: 'Medicine' }, error: null }); expect((await resolvePosBarcode('org', ' 00123 ')).id).toBe('p'); expect(mocks.chain.eq).toHaveBeenCalledWith('barcode', '00123'); expect(mocks.chain.eq).toHaveBeenCalledWith('status', 'active'); });
  it('never auto-selects duplicate mappings to different products', async () => { mocks.chain.limit!.mockResolvedValue({ data: [{ product_id: 'p' }, { product_id: 'q' }], error: null }); await expect(resolvePosBarcode('org', '123')).rejects.toThrow('POS_BARCODE_AMBIGUOUS'); });
  it('returns useful unknown barcode state', async () => { await expect(resolvePosBarcode('org', '999')).rejects.toThrow('POS_BARCODE_UNKNOWN'); });
  it('paginates beyond the latest 100 with a lookahead and stable order', async () => { mocks.chain.range!.mockResolvedValue({ data: Array.from({ length: 26 }, (_, id) => ({ id })), error: null }); const result = await salesPage('org', 'branch', 'SALE-1', '2026-11-18', 5); expect(mocks.chain.range).toHaveBeenCalledWith(125, 150); expect(mocks.chain.eq).toHaveBeenCalledWith('branch_id', 'branch'); expect(mocks.chain.ilike).toHaveBeenCalledWith('sale_number', '%SALE-1%'); expect(mocks.chain.gte).toHaveBeenCalledWith('completed_at', expect.any(String)); expect(result.items).toHaveLength(25); expect(result.hasMore).toBe(true); });
  it('scopes accepted-sale recovery by organization, branch and original identity', async () => { await saleByIdentity('org', 'branch', 'stable'); expect(mocks.chain.eq).toHaveBeenCalledWith('idempotency_key', 'stable'); expect(mocks.chain.eq).toHaveBeenCalledWith('organization_id', 'org'); expect(mocks.chain.eq).toHaveBeenCalledWith('branch_id', 'branch'); });
  it('scopes refund recovery to the original sale and action identity', async () => { await refundByIdentity('org', 'sale', 'stable-refund'); expect(mocks.chain.eq).toHaveBeenCalledWith('sale_id', 'sale'); expect(mocks.chain.eq).toHaveBeenCalledWith('idempotency_key', 'stable-refund'); });
});
describe('authoritative quoted sale transport', () => {
  it('preserves the exact accepted quote and attempt on a dropped response retry', async () => { const input = { organizationId: 'org', branchId: 'branch', saleNumber: 'SALE-stable', lines: [{ product_id: 'p', quantity: 1 }], payments: [{ method: 'CASH' as const, amount: 5 }], expectedQuote: { total_amount: 5, items: [] }, cashTendered: 10, idempotencyKey: 'stable' }; mocks.rpc.mockResolvedValueOnce({ error: new Error('dropped') }); await expect(completeSale(input)).rejects.toThrow('dropped'); await completeSale(input); expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]); expect(mocks.rpc).toHaveBeenCalledWith('complete_sale_with_customer', expect.objectContaining({ p_expected_quote: input.expectedQuote, p_cash_tendered: 10, p_idempotency_key: 'stable', p_payments: [{ method: 'CASH', amount: 5 }] })); });
  it('leaves established offline replay command shape unchanged', async () => { await completeSale({ organizationId: 'org', branchId: 'branch', saleNumber: 'SALE', lines: [], payments: [], idempotencyKey: 'stable' }); expect(mocks.rpc.mock.calls[0]?.[1]).not.toHaveProperty('p_expected_quote'); });
  it('propagates stock rejection without generating a local quote', async () => { mocks.rpc.mockResolvedValue({ error: { code: '23514', message: 'INSUFFICIENT_STOCK' } }); await expect(quoteSale('org', 'branch', [{ product_id: 'p', quantity: 999 }])).rejects.toEqual({ code: '23514', message: 'INSUFFICIENT_STOCK' }); });
});
