import { beforeEach, describe, expect, it, vi } from 'vitest';
import { customerPage, customerDuplicates, saveCustomerAttempt } from './customerWorkflow';
import { salesPage, saleDetail } from './posCompletion';
import { completeSale } from './sales';
import { customerDraft, type CustomerAttempt } from '../domain/customerWorkflow';
const f = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), calls: [] as unknown[][], tables: {} as Record<string, Record<string, unknown>[]>, drop: '', blockUpdate: false }));
vi.mock('../lib/supabase', () => ({ supabase: { from: f.from, rpc: f.rpc } }));
beforeEach(() => {
  vi.clearAllMocks(); f.calls = []; f.tables = { customers: [], sales: [], sale_items: [], payments: [], sale_refunds: [], profiles: [] }; f.drop = ''; f.blockUpdate = false;
  f.rpc.mockResolvedValue({ data: 'sale', error: null });
  f.from.mockImplementation((table: string) => {
    let operation = 'read', body: Record<string, unknown> = {}, one = false, from = 0, to = 1000;
    const filters: [string, unknown][] = []; let exclude = ''; let or = '';
    const q = {
      select: (...args: unknown[]) => { f.calls.push(['select', ...args]); return q; },
      eq: (key: string, value: unknown) => { f.calls.push(['eq', key, value]); filters.push([key, value]); return q; },
      neq: (_: string, value: string) => { exclude = value; return q; },
      or: (value: string) => { or = value; f.calls.push(['or', value]); return q; },
      order: (...args: unknown[]) => { f.calls.push(['order', ...args]); return q; },
      range: (a: number, b: number) => { from = a; to = b; f.calls.push(['range', a, b]); return q; },
      limit: (n: number) => { to = n - 1; return q; },
      single: () => { one = true; return q; }, maybeSingle: () => { one = true; return q; },
      insert: (value: Record<string, unknown>) => { operation = 'insert'; body = value; return q; },
      update: (value: Record<string, unknown>) => { operation = 'update'; body = value; return q; },
      then: (resolve: (r: unknown) => unknown) => {
        const all = f.tables[table] ?? [];
        let rows = all.filter(row => filters.every(([key, value]) => row[key] === value) && row.id !== exclude);
        if (or && operation === 'read') {
          const phone = or.match(/phone\.eq\."([^"]+)"/)?.[1]; const email = or.match(/email\.ilike\."([^"]+)"/)?.[1];
          const phonePattern = or.match(/phone\.match\.("(?:[^"\\]|\\.)*")/)?.[1];
          if (phone || email || phonePattern) rows = rows.filter(row => row.phone === phone || String(row.email ?? '').toLowerCase() === email?.toLowerCase() || (phonePattern && new RegExp(JSON.parse(phonePattern)).test(String(row.phone ?? ''))));
        }
        if (operation === 'insert') { const saved = { ...body, updated_at: 'accepted-version', marketing_consent: false, service_notification_consent: true }; all.push(saved); rows = [saved]; }
        if (operation === 'update') { if (f.blockUpdate) rows = []; else rows.forEach(row => Object.assign(row, body, { updated_at: 'accepted-version' })); }
        if (operation === f.drop) { f.drop = ''; return Promise.resolve(resolve({ data: null, error: { message: 'response lost after commit' } })); }
        return Promise.resolve(resolve({ data: one ? rows[0] ?? null : rows.slice(from, to + 1), error: null }));
      },
    };
    return q;
  });
});
const attempt = (): CustomerAttempt => ({ id: 'stable-id', organizationId: 'org', originalUpdatedAt: null, draft: { ...customerDraft(), full_name: 'Client', phone: '5145550123', email: 'Client@example.test' } });
describe('bounded existing-model customer operations', () => {
  it('returns 25 rows plus lookahead with stable order, status, org and phone/name/email search', async () => {
    f.tables.customers = Array.from({ length: 80 }, (_, id) => ({ id: String(id), organization_id: 'org', status: 'active' }));
    const result = await customerPage('org', '514', 'active', 2); expect(result.items).toHaveLength(25); expect(result.hasMore).toBe(true);
    expect(f.calls).toContainEqual(['range', 50, 75]); expect(f.calls).toContainEqual(['eq', 'organization_id', 'org']); expect(f.calls).toContainEqual(['order', 'id']); expect(f.calls.find(c => c[0] === 'or')?.[1]).toContain('full_name.ilike."%514%",phone.ilike."%514%",email.ilike."%514%",phone.match.');
  });
  it('validates page bounds', async () => { await expect(customerPage('org', '', 'active', -1)).rejects.toThrow('CUSTOMER_INVALID'); expect(f.from).not.toHaveBeenCalled(); });
  it('creates only the existing profile using the stable UUID', async () => { const result = await saveCustomerAttempt(attempt()); expect(result.id).toBe('stable-id'); expect(f.tables.customers).toHaveLength(1); expect(f.tables.customers![0]).not.toHaveProperty('customer_id'); });
  it('recovers a dropped create result without a second insert', async () => { f.drop = 'insert'; await expect(saveCustomerAttempt(attempt())).rejects.toMatchObject({ message: expect.stringContaining('lost') }); const accepted = await saveCustomerAttempt(attempt()); expect(accepted.id).toBe('stable-id'); expect(f.tables.customers).toHaveLength(1); });
  it('recovers a dropped edit without rewriting historical transactions or applying it again', async () => {
    const prior = { ...attempt().draft, id: 'stable-id', organization_id: 'org', updated_at: 'old' }; f.tables.customers = [prior]; f.tables.sales = [{ id: 'sale', customer_id: 'stable-id', total_amount: 20 }];
    const edit = { ...attempt(), originalUpdatedAt: 'old', draft: { ...attempt().draft, full_name: 'Corrected' } }; f.drop = 'update';
    await expect(saveCustomerAttempt(edit)).rejects.toMatchObject({ message: expect.any(String) }); expect((await saveCustomerAttempt(edit)).full_name).toBe('Corrected'); expect(f.tables.sales).toEqual([{ id: 'sale', customer_id: 'stable-id', total_amount: 20 }]);
  });
  it('rejects stale and concurrent edits instead of overwriting another correction', async () => { f.tables.customers = [{ ...attempt().draft, id: 'stable-id', organization_id: 'org', updated_at: 'newer', full_name: 'Other' }]; await expect(saveCustomerAttempt({ ...attempt(), originalUpdatedAt: 'old' })).rejects.toThrow('CUSTOMER_CONFLICT'); });
  it('detects zero-row conditional updates', async () => { f.tables.customers = [{ ...attempt().draft, id: 'stable-id', organization_id: 'org', updated_at: 'old' }]; f.blockUpdate = true; await expect(saveCustomerAttempt({ ...attempt(), originalUpdatedAt: 'old', draft: { ...attempt().draft, full_name: 'Changed' } })).rejects.toThrow('CUSTOMER_CONFLICT'); });
  it.each(['phone','email'] as const)('warns on duplicate %s without inserting a profile', async field => { f.tables.customers = [{ id: 'existing', organization_id: 'org', status: 'active', [field]: attempt().draft[field] }]; await expect(saveCustomerAttempt(attempt())).rejects.toThrow('CUSTOMER_DUPLICATE'); expect(f.tables.customers).toHaveLength(1); });
  it('finds formatting variants with the exact same digits without changing stored phones', async () => { f.tables.customers = [{ id:'existing',organization_id:'org',status:'active',phone:'+1 (514) 555-0123' }]; const matches = await customerDuplicates('org',{ ...attempt().draft,phone:'15145550123',email:null },'other'); expect(matches).toHaveLength(1); expect(matches[0]!.phone).toBe('+1 (514) 555-0123'); });
  it('restores an archived profile using the same id', async () => { f.tables.customers = [{ ...attempt().draft,id:'stable-id',organization_id:'org',status:'archived',updated_at:'old' }]; await saveCustomerAttempt({ ...attempt(),originalUpdatedAt:'old' }); expect(f.tables.customers![0]!.status).toBe('active'); expect(f.tables.customers).toHaveLength(1); });
  it('permits same names without contacts and excludes the current identity', async () => { f.tables.customers = [{ ...attempt().draft, id: 'stable-id', organization_id: 'org', status: 'active' }]; expect(await customerDuplicates('org', attempt().draft, 'stable-id')).toEqual([]); const blank = { ...attempt(), id: 'second', draft: { ...attempt().draft, phone: null, email: null } }; await saveCustomerAttempt(blank); expect(f.tables.customers).toHaveLength(2); });
  it('archives the existing customer and preserves the sale/refund chain', async () => { f.tables.customers = [{ ...attempt().draft, id: 'stable-id', organization_id: 'org', updated_at: 'old' }]; f.tables.sale_refunds = [{ id: 'refund', sale_id: 'original' }]; await saveCustomerAttempt({ ...attempt(), originalUpdatedAt: 'old', draft: { ...attempt().draft, status: 'archived' } }); expect(f.tables.customers![0]!.status).toBe('archived'); expect(f.tables.sale_refunds![0]!.sale_id).toBe('original'); });
});
describe('existing sales and refund read engine', () => {
  it('filters organization-wide history by customer with bounded pages', async () => { await salesPage('org', null, '', '', 0, 'UTC', 'customer'); expect(f.calls).toContainEqual(['eq','customer_id','customer']); expect(f.calls).not.toContainEqual(['eq','branch_id',null]); expect(f.calls).toContainEqual(['range',0,25]); });
  it('retains branch-scoped ordinary history', async () => { await salesPage('org', 'branch'); expect(f.calls).toContainEqual(['eq','branch_id','branch']); });
  it('returns no purchases for a new customer', async () => { expect(await salesPage('org', null, '', '', 0, 'UTC', 'new')).toEqual({ items: [], hasMore: false }); });
  it.each([null,'customer'])('preserves optional checkout identity %s with the existing transaction RPC', async customerId => { await completeSale({ organizationId: 'org', branchId: 'branch', saleNumber: 'SALE', lines: [], payments: [], idempotencyKey: 'stable', customerId }); expect(f.rpc).toHaveBeenCalledWith('complete_sale_with_customer', expect.objectContaining({ p_customer_id: customerId, p_idempotency_key: 'stable' })); });
  it('resolves an archived profile by stable ID and refunds by the original sale', async () => {
    f.tables.sales = [{ id:'sale',organization_id:'org',branch_id:'branch',customer_id:'stable-id',created_by:'user' }]; f.tables.customers = [{ id:'stable-id',organization_id:'org',full_name:'Edited archived name',status:'archived',notes:'private',phone:'private' }];
    const detail = await saleDetail('org','branch','sale'); expect(detail.customer).toEqual({id:'stable-id',full_name:'Edited archived name',status:'archived'}); expect(f.calls).toContainEqual(['eq','sale_id','sale']);
  });
});
