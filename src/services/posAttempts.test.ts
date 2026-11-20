import { describe, expect, it } from 'vitest';
import { createPosAttemptStore } from './posAttempts';
import { LocalStore } from '../offline/localStore';
import type { KeyValueStorage } from '../offline/storage';
function memory(): KeyValueStorage { const rows = new Map<string, string>(); return { getItem: key => rows.get(key) ?? null, setItem: (key, value) => { rows.set(key, value); }, removeItem: key => { rows.delete(key); } }; }
describe('durable confirmed POS attempts', () => {
  it('preserves exact sale and refund identities across reload and replica cleanup', () => {
    const storage = memory(), first = createPosAttemptStore(storage), replica = new LocalStore(storage);
    const sale = { identity: { idempotencyKey: 'stable-sale' }, input: { payments: [{ method: 'CASH', amount: 12 }], cashTendered: 20, expectedQuote: { total_amount: 12 } }, cart: [{ product_id: 'p', quantity: 3 }] };
    const refund = { idempotencyKey: 'stable-refund', items: [{ sale_item_id: 'second', quantity: 0.5 }] };
    first.save('sale:user-a:org:branch', sale); first.save('refund:user-a:org:branch:sale', refund);
    replica.clear();
    const restarted = createPosAttemptStore(storage);
    expect(restarted.read('sale:user-a:org:branch')).toEqual(sale); expect(restarted.read('refund:user-a:org:branch:sale')).toEqual(refund);
    expect(restarted.read('sale:user-b:org:branch')).toBeNull(); expect(restarted.read('sale:user-a:other-org:branch')).toBeNull(); expect(restarted.read('sale:user-a:org:other-branch')).toBeNull();
    restarted.remove('sale:user-a:org:branch'); expect(first.read('sale:user-a:org:branch')).toBeNull(); expect(first.read('refund:user-a:org:branch:sale')).toEqual(refund);
  });
  it('fails before dispatch if durable storage is unavailable', () => { const storage = memory(); storage.setItem = () => { throw new Error('unavailable'); }; expect(() => createPosAttemptStore(storage).save('sale:user-a:org:branch', { id: 'stable' })).toThrow('unavailable'); });
});
