import { describe, expect, it } from 'vitest';
import { barcodeProductIds, cashPayment, quoteFingerprint, refundableQuantity, refundSelection, stockQuantity } from './posCompletion';
import type { SaleItem, SaleQuote } from '../services/sales';
const item = { id: 'second', quantity: 3, unit_price: 2.5 } as SaleItem;
const quote: SaleQuote = { total_amount: 5, items: [{ product_id: 'p', batch_id: 'lot-a', quantity: 2, unit_price: 2.5, line_total: 5, expiry_date: '2099-01-01' }] };
describe('POS stock units, payment and quote review', () => {
  it.each(['0', '-1', '1e2', '1,2.3', '1 000', '', '1.12345', '1000000000000'])('rejects invalid quantity %s', raw => expect(stockQuantity(raw)).toBeNull());
  it.each([['1,25', 1.25], ['2.0001', 2.0001], ['1', 1]])('accepts stock-scale quantity %s', (raw, expected) => expect(stockQuantity(String(raw))).toBe(expected));
  it('rounds cash change once and records only the amount due as payment', () => { expect(cashPayment(7.6, '10,00')).toEqual({ tendered: 10, change: 2.4 }); expect(cashPayment(7.6, '7.60')).toEqual({ tendered: 7.6, change: 0 }); });
  it.each(['7', '-10', '10,001', '1e2', ''])('rejects invalid/insufficient tender %s', raw => expect(cashPayment(7.6, raw)).toBeNull());
  it('detects same-total allocation changes, unit price changes and expiry changes', () => { const original = quoteFingerprint(quote); for (const change of [{ batch_id: 'lot-b' }, { unit_price: 9 }, { expiry_date: '2099-02-01' }, { quantity: 1 }]) expect(quoteFingerprint({ ...quote, items: quote.items.map(i => ({ ...i, ...change })) })).not.toBe(original); });
  it('ignores display-only lot metadata when comparing quotes', () => expect(quoteFingerprint({ ...quote, items: quote.items.map(i => ({ ...i, lot_number: 'LOT' })) })).toBe(quoteFingerprint(quote)));
  it('deduplicates mappings to the same product but retains ambiguity between products', () => { expect(barcodeProductIds([{ product_id: 'p' }, { product_id: 'p' }])).toEqual(['p']); expect(barcodeProductIds([{ product_id: 'p' }, { product_id: 'q' }])).toHaveLength(2); });
});
describe('explicit refund selection', () => {
  const refunds = [{ sale_item_id: 'first', quantity: 99 }, { sale_item_id: 'second', quantity: 1 }, { sale_item_id: 'second', quantity: 0.5 }];
  it('subtracts only the selected item’s prior refunds', () => expect(refundableQuantity(item, refunds)).toBe(1.5));
  it('supports a partial non-first item with a French decimal comma', () => expect(refundSelection(item, '0,5', refunds)).toEqual({ sale_item_id: 'second', quantity: 0.5, amount: 1.25 }));
  it.each(['0', '-1', '1,5001', '2', '1e2', '1,2.3'])('blocks invalid or excessive refund %s', raw => expect(refundSelection(item, raw, refunds)).toBeNull());
  it('blocks a second full refund after the remaining quantity is used', () => expect(refundSelection(item, '0.1', [...refunds, { sale_item_id: 'second', quantity: 1.5 }])).toBeNull());
  it('requires explicit selection', () => expect(refundSelection(undefined, '1', [])).toBeNull());
});
