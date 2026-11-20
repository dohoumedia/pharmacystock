import { describe, expect, it } from 'vitest';
import { adjustmentValues, assertInventoryScope, countValues, InventoryFormStore, inventoryFormScope, inventoryQuantity, variance, type CountDraft } from './inventoryCompletion';
import type { BatchChoice } from '../services/catalogReadiness';
import type { InventoryBalance } from '../services/inventory';
import en from '../i18n/inventoryReady.en.json';
import fr from '../i18n/inventoryReady.fr.json';
const batch = { id: 'batch', organization_id: 'org', branch_id: 'a', status: 'ACTIVE' } as BatchChoice;
const balance = { batch_id: 'batch', organization_id: 'org', branch_id: 'a', on_hand_quantity: 10, reserved_quantity: 0, available_quantity: 10 } as InventoryBalance;
const draft: CountDraft = { id: 'count', organizationId: 'org', branchId: 'a', createdAt: '', phase: 'editing', entries: [{ batch, raw: '8,125', expected: 10 }] };
describe('inventory completion domain', () => {
  it.each(['0', '-1', '1,2,3', '1.2.3', '1e2', '', '1 000', '0.00001', '100000000000000', '90071992547409.12345'])('rejects adjustment input %s without clamping', (raw) => { expect(() => inventoryQuantity(raw)).toThrow('QUANTITY_INVALID'); });
  it('accepts decimal comma, four places and explicit counted zero', () => { expect(inventoryQuantity('1,2345')).toBe(1.2345); expect(inventoryQuantity('0', true)).toBe(0); });
  it('validates direction, reason, branch, stock and inbound status', () => {
    expect(adjustmentValues('2,5', 'OUT', 'Lost', batch, balance, 'org', 'a')).toBe(-2.5);
    expect(adjustmentValues('2', 'IN', 'Found', batch, balance, 'org', 'a')).toBe(2);
    expect(() => adjustmentValues('1', 'OUT', ' ', batch, balance, 'org', 'a')).toThrow('REASON_REQUIRED');
    expect(() => adjustmentValues('11', 'OUT', 'Lost', batch, balance, 'org', 'a')).toThrow('INSUFFICIENT_STOCK');
    expect(() => adjustmentValues('1', 'IN', 'Found', { ...batch, branch_id: 'b' }, balance, 'org', 'a')).toThrow('BATCH_INVALID');
    expect(() => adjustmentValues('1', 'IN', 'Found', batch, null, 'org', 'a')).toThrow('BATCH_INVALID');
    expect(() => adjustmentValues('1', 'IN', 'Found', { ...batch, status: 'RECALLED' }, balance, 'org', 'a')).toThrow('STATUS_BLOCKS_INBOUND');
  });
  it('calculates zero, positive, negative and fractional variances exactly at ledger scale', () => { expect(variance(10, 10)).toBe(0); expect(variance(12.5, 10)).toBe(2.5); expect(variance(8.125, 10)).toBe(-1.875); expect(variance(0.3, 0.1)).toBe(0.2); });
  it('requires all selected lines and preserves explicit zero', () => { expect(countValues(draft)).toEqual([{ batchId: 'batch', countedQuantity: 8.125 }]); expect(() => countValues({ ...draft, entries: [{ ...draft.entries[0]!, raw: '' }] })).toThrow(); expect(() => countValues({ ...draft, entries: [] })).toThrow('INCOMPLETE'); expect(countValues({ ...draft, entries: [{ ...draft.entries[0]!, raw: '0' }] })[0]!.countedQuantity).toBe(0); });
  it('never rebinds counts to a different branch', () => { expect(() => assertInventoryScope(draft, 'org', 'b')).toThrow('BRANCH_CHANGED'); expect(() => countValues({ ...draft, branchId: 'b' })).toThrow('BATCH_INVALID'); });
  it('persists unfinished raw entries and phase across a fresh store and isolates users/branches', () => {
    const map = new Map<string, string>(); const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
    const key = inventoryFormScope('u', 'org', 'a'); new InventoryFormStore(storage).set(key, draft);
    expect(new InventoryFormStore(storage).get(key)).toEqual(draft);
    expect(new InventoryFormStore(storage).get(inventoryFormScope('other', 'org', 'a'))).toBeNull();
    expect(new InventoryFormStore(storage).get(inventoryFormScope('u', 'org', 'b'))).toBeNull();
  });
  it('fails closed if a durable write fails', () => { const store = new InventoryFormStore({ getItem: () => null, setItem: () => { throw new Error('disk full'); }, removeItem: () => undefined }); expect(() => store.set('action', draft)).toThrow('disk full'); });
  it('has matching nonempty EN/FR messages', () => { expect(Object.keys(en.inventoryReady).sort()).toEqual(Object.keys(fr.inventoryReady).sort()); for (const value of Object.values(fr.inventoryReady)) expect(value.trim()).not.toBe(''); });
});
