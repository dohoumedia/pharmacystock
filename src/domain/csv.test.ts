import { describe, expect, it } from 'vitest';
import { CsvParseError, parseCsv, parseCsvDocument } from './csv';
import { importPostingErrorKey, previewImport } from './importPreview';
import en from '../i18n/imports.en.json';
import fr from '../i18n/imports.fr.json';

describe('CSV record parsing', () => {
  it('preserves commas inside a supplier name', () => {
    expect(parseCsv('name,phone\r\n"Supplier, SARL",123')).toEqual([{ name: 'Supplier, SARL', phone: '123' }]);
  });
  it('unescapes doubled quotes and preserves quoted newlines', () => {
    expect(parseCsv('name,notes\n"Lab ""A""","first\r\nsecond"')).toEqual([{ name: 'Lab "A"', notes: 'first\nsecond' }]);
  });
  it('supports UTF-8 BOM, headers and empty fields without dropping zero', () => {
    expect(parseCsv('\uFEFFname,quantity,notes\r\nA,0,\r\n\r\n,,\r\nB,2,ok')).toEqual([
      { name: 'A', quantity: '0', notes: '' }, { name: 'B', quantity: '2', notes: 'ok' },
    ]);
  });
  it.each(['name,name\nA,B', 'name,\nA,B', 'name,phone\nA', 'name\nA,B', 'name\n"never closed', 'name\nBad"quote', 'name\n"closed"extra'])('reports malformed input explicitly (%s)', (text) => {
    expect(parseCsvDocument(text).errors.length).toBeGreaterThan(0);
    expect(() => parseCsv(text)).toThrow(CsvParseError);
  });
  it('retains invalid rows and original line numbers beside valid rows', () => {
    const result = parseCsvDocument('name,notes\nA,"multi\nline"\n\nB\nC,ok');
    expect(result.records.map((row) => row.rowNumber)).toEqual([2, 5, 6]);
    expect(result.records[1]?.errors).toEqual([{ rowNumber: 5, code: 'CSV_COLUMN_COUNT' }]);
    expect(result.records[2]?.data.name).toBe('C');
  });
  it('keeps trailing quoted empty columns', () => {
    expect(parseCsv('name,notes\nA,""')).toEqual([{ name: 'A', notes: '' }]);
  });
  it('reports wrong-width empty records instead of treating them as blank lines', () => {
    const document = parseCsvDocument('name,phone\nA,123\n,,');
    expect(document.records).toHaveLength(2);
    expect(document.records[1]?.errors).toEqual([{ rowNumber: 3, code: 'CSV_COLUMN_COUNT' }]);
    expect(parseCsvDocument(',\nA,B').errors.some((issue) => issue.code === 'CSV_HEADER_REQUIRED')).toBe(true);
  });
  it('handles header-only and empty compatibility input', () => {
    expect(parseCsv('name,phone')).toEqual([]);
    expect(parseCsv('')).toEqual([]);
  });
});

describe('import preview and validation', () => {
  it('requires preview values without modifying names that contain CSV punctuation', () => {
    const preview = previewImport('name,phone\n"Supplier, SARL",12345', 'SUPPLIERS');
    expect(preview.valid).toBe(true);
    expect(preview.rows[0]?.data).toEqual({ name: 'Supplier, SARL', phone: '12345' });
  });
  it('validates and normalizes opening stock decimals including French commas', () => {
    const preview = previewImport('sku,lot_number,quantity,expiry_date,purchase_cost,selling_price\nP-250,LOT-1,"12,5",2028-02-29,"1,20","2,50"', 'OPENING_STOCK');
    expect(preview.valid).toBe(true);
    expect(preview.rows[0]?.data).toEqual({ sku: 'P-250', lot_number: 'LOT-1', quantity: '12.5', expiry_date: '2028-02-29', purchase_cost: '1.2', selling_price: '2.5', reason: 'OPENING_STOCK_IMPORT' });
  });
  it.each(['sku', 'barcode', 'product_id'])('supports opening-stock identity column %s', (identity) => {
    const value = identity === 'product_id' ? '00000000-0000-0000-0000-000000000001' : 'item-1';
    expect(previewImport(`${identity},lot_number,quantity,expiry_date,selling_price\n${value},L,1,2028-01-01,2`, 'OPENING_STOCK').valid).toBe(true);
  });
  it('returns every row-level error and never silently omits incomplete opening stock', () => {
    const preview = previewImport('sku,lot_number,quantity,expiry_date,purchase_cost,selling_price\nA,L,2,2028-01-01,1,2\nB,,abc,2027-02-29,-1,', 'OPENING_STOCK');
    expect(preview.valid).toBe(false);
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows[1]?.errors.map((issue) => issue.code)).toEqual(expect.arrayContaining(['IMPORT_LOT_REQUIRED', 'IMPORT_QUANTITY', 'IMPORT_EXPIRY', 'IMPORT_PURCHASE_COST', 'IMPORT_SELLING_PRICE']));
  });
  it('flags precision that the opening-stock posting model cannot preserve', () => {
    const preview = previewImport('sku,lot_number,quantity,expiry_date,purchase_cost,selling_price\nA,L,"1,12345",2028-01-01,"2,001","3,001"', 'OPENING_STOCK');
    expect(preview.valid).toBe(false);
    expect(preview.errors.map((issue) => issue.code)).toEqual(expect.arrayContaining(['IMPORT_QUANTITY_PRECISION', 'IMPORT_MONEY_PRECISION']));
    expect(previewImport('sku,lot_number,quantity,expiry_date,purchase_cost,selling_price\nA,L,1.1234,2028-01-01,2.01,3.01', 'OPENING_STOCK').valid).toBe(true);
  });
  it('rejects missing headers, unknown headers and missing product identities', () => {
    expect(previewImport('name,qty\nA,1', 'PRODUCTS').errors.map((issue) => issue.code)).toContain('IMPORT_UNKNOWN_HEADER');
    expect(previewImport('quantity\n1', 'OPENING_STOCK').errors.map((issue) => issue.code)).toContain('IMPORT_REQUIRED_HEADER');
    expect(previewImport('sku,lot_number,quantity,expiry_date,selling_price\n,L,1,2028-01-01,2', 'OPENING_STOCK').errors.map((issue) => issue.code)).toContain('IMPORT_IDENTITY_REQUIRED');
  });
  it('detects repeated catalog SKU/barcode and opening lots inside a file', () => {
    expect(previewImport('name,sku,barcode\nA,SKU,123\nB,SKU,123', 'PRODUCTS').valid).toBe(false);
    expect(previewImport('sku,lot_number,quantity,expiry_date,selling_price\nA,L,1,2028-01-01,2\nA,L,1,2028-01-01,2', 'OPENING_STOCK').errors.map((issue) => issue.code)).toContain('IMPORT_DUPLICATE_ROW');
  });
  it('rejects unsupported stock units and customer languages', () => {
    expect(previewImport('name,stock_unit\nA,crate', 'PRODUCTS').errors.map((issue) => issue.code)).toContain('IMPORT_STOCK_UNIT');
    expect(previewImport('name,locale\nA,de', 'CUSTOMERS').errors.map((issue) => issue.code)).toContain('IMPORT_LOCALE');
  });
  it('bounds file sizes and batch sizes with explicit errors', () => {
    expect(previewImport('x'.repeat(2_000_001), 'PRODUCTS').errors[0]?.code).toBe('IMPORT_TOO_LARGE');
    const preview = previewImport('name\n' + Array.from({ length: 501 }, (_, i) => `A${i}`).join('\n'), 'PRODUCTS');
    expect(preview.rows).toHaveLength(501);
    expect(preview.errors.map((issue) => issue.code)).toContain('IMPORT_TOO_MANY_ROWS');
  });
  it('explains server posting failures with localized categories', () => {
    expect(importPostingErrorKey('OPENING_STOCK_PRODUCT_NOT_FOUND')).toBe('imports.posting.product');
    expect(importPostingErrorKey('OPENING_STOCK_BATCH_MISMATCH')).toBe('imports.posting.batch');
    expect(importPostingErrorKey('inventory duplicate key value violates unique constraint')).toBe('imports.posting.duplicate');
  });
  it('provides equivalent EN/FR keys and parser errors', () => {
    const keys = (value: object, prefix = ''): string[] => Object.entries(value).flatMap(([key, item]) => typeof item === 'object' ? keys(item, `${prefix}${key}.`) : `${prefix}${key}`);
    expect(keys(en).sort()).toEqual(keys(fr).sort());
    for (const error of previewImport('name\n"broken', 'PRODUCTS').errors) expect(error.code in en.imports.errors).toBe(true);
  });
});
