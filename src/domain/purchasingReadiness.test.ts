import { describe, expect, it } from 'vitest';
import { LocalStore } from '../offline/localStore';
import { assertRequestBranch, canReceiveOrder, purchasingScope, remainingQuantity, retainPurchasingRequest, PurchasingRequestStore, type PurchasingRequest } from './purchasingReadiness';
import { validateReceiptRows } from './receivingValidation';
import en from '../i18n/purchasingReady.en.json';
import fr from '../i18n/purchasingReady.fr.json';

const row = { quantity: '2,5', lotNumber: 'LOT-A', expiryDate: '2028-02-29', unitCost: '1,25', sellingPrice: '2,50' };
const request: PurchasingRequest = { kind: 'receipt', organizationId: 'org', branchId: 'a', rejected: false, input: { purchaseOrderId: 'po', receiptNumber: 'R1', idempotencyKey: 'stable', lines: [{ purchaseOrderLineId: 'line', quantity: 2.5, lotNumber: 'LOT-A', expiryDate: '2028-02-29', unitCost: 1.25, sellingPrice: 2.5 }] } };
const storage = () => { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } }; };

describe('purchasing readiness contracts', () => {
  it('keeps decimal remaining quantities exact over partial receiving sessions', () => { expect(remainingQuantity(0.3, 0.1)).toBe(0.2); expect(remainingQuantity(10, 2.5)).toBe(7.5); expect(remainingQuantity(10, 10)).toBe(0); });
  it('allows only existing receivable states; received/cancelled history remains read-only', () => { for (const state of ['draft', 'ordered', 'partially_received']) expect(canReceiveOrder(state)).toBe(true); for (const state of ['cancelled', 'received', 'unknown']) expect(canReceiveOrder(state)).toBe(false); });
  it('sends a partial multi-product delivery and then the exact remainder', () => {
    const first = validateReceiptRows([{ id: 'a', remaining: 10, draft: row }, { id: 'b', remaining: 3, draft: { ...row, quantity: '3', lotNumber: 'LOT-B' } }]);
    expect(first.lines.map((line) => line.quantity)).toEqual([2.5, 3]); expect(first.issues).toEqual([]);
    const remaining = remainingQuantity(10, first.lines[0]!.quantity);
    expect(validateReceiptRows([{ id: 'a', remaining, draft: { ...row, quantity: '7,5', lotNumber: 'SECOND-LOT' } }]).lines[0]).toMatchObject({ quantity: 7.5, lotNumber: 'SECOND-LOT' });
  });
  it.each(['0', '-1', 'abc', '10.001', '0.0001'])('reports invalid or excessive receipt quantity %s without dropping another valid row', (quantity) => { const result = validateReceiptRows([{ id: 'a', remaining: 10, draft: row }, { id: 'b', remaining: 10, draft: { ...row, quantity } }]); expect(result.lines).toEqual([]); expect(result.issues).toEqual([{ id: 'b', fields: ['quantity'] }]); });
  it.each(['lotNumber', 'expiryDate', 'unitCost', 'sellingPrice'] as const)('identifies invalid %s on its intended row', (field) => {
    const invalid = field === 'lotNumber' ? ' ' : field === 'expiryDate' ? '2027-02-29' : field === 'unitCost' ? '-0,01' : '0';
    expect(validateReceiptRows([{ id: 'a', remaining: 10, draft: { ...row, [field]: invalid } }]).issues[0]?.fields).toContain(field);
  });
  it('rejects cost/price precision that the database would round', () => { expect(validateReceiptRows([{ id: 'a', remaining: 10, draft: { ...row, unitCost: '1,001', sellingPrice: '2,555' } }]).issues[0]?.fields).toEqual(['unitCost', 'sellingPrice']); });
  it('restores an uncertain operation after remount and refuses a changed request/key', () => {
    const durable = storage(); const key = purchasingScope('user', 'org', 'a');
    const first = retainPurchasingRequest(new LocalStore(durable), key, request);
    const retry = retainPurchasingRequest(new LocalStore(durable), key, { ...request, input: { ...request.input, receiptNumber: 'DIFFERENT', idempotencyKey: 'new' } });
    expect(retry).toEqual(first); expect(retry.input.idempotencyKey).toBe('stable'); expect(retry.kind === 'receipt' && retry.input.receiptNumber).toBe('R1');
  });
  it('isolates pending forms by user, organization and branch and rejects silent rebinding', () => {
    const store = new LocalStore(storage()); const key = purchasingScope('u1', 'org', 'a'); retainPurchasingRequest(store, key, request);
    expect(store.get(purchasingScope('u1', 'org', 'b'))).toBeNull(); expect(store.get(purchasingScope('u2', 'org', 'a'))).toBeNull();
    expect(() => assertRequestBranch(request, 'org', 'b')).toThrow('PURCHASING_BRANCH_CHANGED'); expect(() => assertRequestBranch(request, 'org', 'a')).not.toThrow();
  });
  it('keeps uncertain purchasing requests after the read replica is cleared on sign-out', () => { const durable = storage(); const key = purchasingScope('user', 'org', 'a'); retainPurchasingRequest(new PurchasingRequestStore(durable), key, request); new LocalStore(durable).clear(); expect(new PurchasingRequestStore(durable).get<PurchasingRequest>(key)?.data).toEqual(request); });
  it('does not send when durable persistence fails', () => { const store = new LocalStore({ getItem: () => null, setItem: () => { throw new Error('disk full'); }, removeItem: () => undefined }); expect(() => retainPurchasingRequest(store, 'key', request)).toThrow('disk full'); });
  it('has complete nonempty EN/FR messages, with explicit uncertainty and cancellation limits', () => {
    const keys = (object: object, prefix = ''): string[] => Object.entries(object).flatMap(([key, value]) => typeof value === 'object' ? keys(value, `${prefix}${key}.`) : [`${prefix}${key}`]);
    expect(keys(en)).toEqual(keys(fr)); for (const locale of [en, fr]) { expect(locale.purchaseReady.pending.length).toBeGreaterThan(20); expect(locale.purchaseReady.noAmend.length).toBeGreaterThan(20); expect(Object.values(locale.purchaseReady.fields).every(Boolean)).toBe(true); }
  });
});
