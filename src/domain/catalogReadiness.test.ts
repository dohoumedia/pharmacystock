import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import { hasDecimalPrecision, isDefinitiveRejection, parseLocaleNumber, validDateOnly } from './numericInput';
import { validateReceiptRows } from './receivingValidation';
import { STOCK_UNITS, stockUnitLabel } from './stockUnits';
import en from '../i18n/catalogReady.en.json';
import fr from '../i18n/catalogReady.fr.json';
import importsEn from '../i18n/imports.en.json';
import importsFr from '../i18n/imports.fr.json';

const complete = { quantity: '2,5', unitCost: '1,25', sellingPrice: '2,50', lotNumber: 'LOT-1', expiryDate: '2028-02-29' };
describe('catalog and receiving input', () => {
  it.each([['12,5', 12.5], ['12.5', 12.5], ['0', 0], ['-1,5', -1.5]])('parses decimal input %s', (text, expected) => expect(parseLocaleNumber(text)).toBe(expected));
  it.each(['', '1,2,3', '1.234,5', '1e3', 'Infinity', '12 tablets', 'NaN'])('rejects ambiguous or invalid numeric input %s', (text) => expect(parseLocaleNumber(text)).toBeNull());
  it('validates real calendar dates', () => { expect(validDateOnly('2028-02-29')).toBe(true); expect(validDateOnly('2027-02-29')).toBe(false); expect(validDateOnly('2028-13-01')).toBe(false); });
  it('distinguishes known transaction rejection from uncertain network outcome', () => { expect(isDefinitiveRejection({ code: '23514' })).toBe(true); expect(isDefinitiveRejection(new TypeError('Failed to fetch'))).toBe(false); expect(isDefinitiveRejection({ code: '503' })).toBe(false); });
  it('matches database precision before creating an opening request', () => { expect(hasDecimalPrecision(2.34, 2)).toBe(true); expect(hasDecimalPrecision(2.345, 2)).toBe(false); expect(hasDecimalPrecision(1.2345, 4)).toBe(true); expect(hasDecimalPrecision(1.23456, 4)).toBe(false); });
  it('submits all complete intended rows with French quantity/cost/price', () => {
    const result = validateReceiptRows([{ id: 'one', remaining: 5, draft: complete }, { id: 'two', remaining: 10, draft: { ...complete, quantity: '3' } }]);
    expect(result.issues).toEqual([]); expect(result.lines.map((line) => line.quantity)).toEqual([2.5, 3]); expect(result.lines[0]).toMatchObject({ unitCost: 1.25, sellingPrice: 2.5 });
  });
  it.each(['lotNumber', 'expiryDate', 'sellingPrice'] as const)('blocks the whole submission and identifies an incomplete intended row (%s)', (field) => {
    const result = validateReceiptRows([{ id: 'valid', remaining: 5, draft: complete }, { id: 'broken', remaining: 5, draft: { ...complete, [field]: '' } }]);
    expect(result.lines).toEqual([]); expect(result.issues).toEqual([{ id: 'broken', fields: [field] }]);
  });
  it('rejects an invalid quantity instead of silently filtering it', () => {
    const result = validateReceiptRows([{ id: 'bad', remaining: 5, draft: { ...complete, quantity: 'abc' } }]); expect(result.issues[0]?.fields).toContain('quantity');
  });
  it('permits blank rows but reports an explicit zero as invalid', () => { expect(validateReceiptRows([{ id: 'a', remaining: 4 }])).toEqual({ lines: [], issues: [] }); expect(validateReceiptRows([{ id: 'b', remaining: 2, draft: { ...complete, quantity: '0' } }]).issues[0]?.fields).toEqual(['quantity']); });
  it('rejects over-receiving and negative cost before sending anything', () => { expect(validateReceiptRows([{ id: 'a', remaining: 1, draft: { ...complete, unitCost: '-1' } }]).issues[0]?.fields).toEqual(['quantity', 'unitCost']); });
});

function keys(value: object, prefix = ''): string[] { return Object.entries(value).flatMap(([key, item]) => typeof item === 'object' && item !== null ? keys(item, `${prefix}${key}.`) : [`${prefix}${key}`]); }
describe('stock units and bilingual coverage', () => {
  it('has equivalent nonempty EN/FR catalog and import keys', () => { expect(keys(en).sort()).toEqual(keys(fr).sort()); expect(keys(importsEn).sort()).toEqual(keys(importsFr).sort()); });
  it('localizes stock unit codes consistently and supports old cached products', async () => {
    const i18n = createInstance(); await i18n.init({ lng: 'en', resources: { en: { translation: en }, fr: { translation: fr } } });
    expect(stockUnitLabel('tablet', i18n.t)).toBe('tablet'); await i18n.changeLanguage('fr'); expect(stockUnitLabel('tablet', i18n.t)).toBe('comprimé'); expect(stockUnitLabel(undefined, i18n.t)).toBe('unité');
    for (const unit of STOCK_UNITS) expect(stockUnitLabel(unit, i18n.t)).not.toContain('catalogReady.');
  });
});
