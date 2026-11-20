import { csvByteLength, parseCsvDocument, type CsvIssue, type CsvRecord, type CsvDocument } from './csv';

export type ImportType = 'PRODUCTS' | 'SUPPLIERS' | 'CUSTOMERS' | 'OPENING_STOCK';
export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_CHARACTERS = 2_000_000;
export type ImportPreview = { headers: string[]; rows: CsvRecord[]; errors: CsvIssue[]; valid: boolean };
export const importColumns: Record<ImportType, string[]> = {
  PRODUCTS: ['name', 'sku', 'barcode', 'generic_name', 'brand_name', 'strength', 'dosage_form', 'package_size', 'stock_unit'],
  SUPPLIERS: ['name', 'code', 'phone', 'email', 'address'],
  CUSTOMERS: ['name', 'phone', 'email', 'locale', 'notes', 'status'],
  OPENING_STOCK: ['sku', 'barcode', 'product_id', 'lot_number', 'quantity', 'expiry_date', 'purchase_cost', 'selling_price', 'reason', 'stock_unit', 'branch_id'],
};
const stockUnits = new Set(['unit', 'tablet', 'capsule', 'bottle', 'box', 'ampoule', 'tube', 'sachet', 'ml', 'g']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Uses the same strict decimal syntax as batch pricing, including French commas.
export function parseImportNumber(value: string): number | null {
  const text = value.trim();
  if (!/^[+-]?(?:\d+|\d*[.,]\d+)$/.test(text)) return null;
  const number = Number(text.replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}
export function isImportDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function importPostingErrorKey(code: string): string {
  if (/FORBIDDEN|PERMISSION|row-level security/i.test(code)) return 'imports.posting.permission';
  if (/PRODUCT.*NOT_FOUND|PRODUCT.*IDENTITY|PRODUCT.*AMBIGUOUS|PRODUCT_ID|PRODUCT_NOT_ACTIVE/i.test(code)) return 'imports.posting.product';
  if (/SELLING_PRICE|PRICE/i.test(code)) return 'imports.posting.price';
  if (/BATCH.*MISMATCH|LOT|EXPIRY|EXPIRED|QUARANTINED|RECALLED|BATCH.*STATUS/i.test(code)) return 'imports.posting.batch';
  if (/QUANTITY|COST|INPUT|REASON/i.test(code)) return 'imports.posting.values';
  if (/duplicate|unique|IDEMPOTENCY/i.test(code)) return 'imports.posting.duplicate';
  return 'imports.posting.failed';
}

/** A bounded, client-side preview. Server constraints remain authoritative. */
export function previewImport(text: string, type: ImportType): ImportPreview {
  if (text.length > MAX_IMPORT_CHARACTERS || csvByteLength(text) > MAX_IMPORT_CHARACTERS) return { headers: [], rows: [], errors: [{ rowNumber: 1, code: 'IMPORT_TOO_LARGE' }], valid: false };
  return validateImportDocument(parseCsvDocument(text), type);
}

export function validateImportDocument(parsed: CsvDocument, type: ImportType): ImportPreview {
  const errors = [...parsed.errors];
  if (parsed.records.length === 0) errors.push({ rowNumber: 1, code: 'IMPORT_EMPTY' });
  if (parsed.records.length > MAX_IMPORT_ROWS) errors.push({ rowNumber: 1, code: 'IMPORT_TOO_MANY_ROWS' });
  if (parsed.headers.some((header) => !importColumns[type].includes(header))) errors.push({ rowNumber: 1, code: 'IMPORT_UNKNOWN_HEADER' });
  const required = type === 'OPENING_STOCK' ? ['lot_number', 'quantity', 'expiry_date', 'selling_price'] : ['name'];
  if (required.some((header) => !parsed.headers.includes(header)) || (type === 'OPENING_STOCK' && !['sku', 'barcode', 'product_id'].some((header) => parsed.headers.includes(header)))) {
    errors.push({ rowNumber: 1, code: 'IMPORT_REQUIRED_HEADER' });
  }
  const seen = new Set<string>();
  const rows = parsed.records.map((record) => {
    const data = Object.fromEntries(Object.entries(record.data).map(([key, value]) => [key, value.trim()]));
    const rowErrors = [...record.errors];
    const issue = (code: string, field?: string) => rowErrors.push({ rowNumber: record.rowNumber, code, ...(field ? { field, value: data[field] ?? '' } : {}) });
    for (const [field, value] of Object.entries(data)) {
      const limit = field === 'name' ? 160 : field === 'notes' ? 2000 : field === 'address' ? 500 : field === 'email' ? 254 : field === 'phone' ? 40 : 200;
      if (value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) issue('IMPORT_FIELD_LENGTH', field);
    }
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) issue('IMPORT_EMAIL', 'email');
    if (data.phone && (!/^\+?[0-9 ()\-.]+$/.test(data.phone) || data.phone.replace(/\D/g, '').length < 5 || data.phone.replace(/\D/g, '').length > 20)) issue('IMPORT_PHONE', 'phone');
    if (type === 'PRODUCTS' && data.barcode && !/^[!-~]{1,128}$/.test(data.barcode)) issue('IMPORT_BARCODE', 'barcode');
    if (type === 'OPENING_STOCK') {
      if (!data.sku && !data.barcode && !data.product_id) issue('IMPORT_IDENTITY_REQUIRED');
      if (data.product_id && !uuid.test(data.product_id)) issue('IMPORT_PRODUCT_ID');
      if (!data.lot_number) issue('IMPORT_LOT_REQUIRED', 'lot_number');
      if (!isImportDate(data.expiry_date ?? '')) issue('IMPORT_EXPIRY', 'expiry_date');
      for (const field of ['quantity', 'purchase_cost', 'selling_price'] as const) {
        const value = data[field] ?? '';
        if (!value && field === 'purchase_cost') continue;
        const number = parseImportNumber(value);
        if (number === null || (field === 'purchase_cost' ? number < 0 : number <= 0)) issue(`IMPORT_${field.toUpperCase()}`, field);
        else {
          const decimalPlaces = value.replace(',', '.').split('.')[1]?.length ?? 0;
          if (decimalPlaces > (field === 'quantity' ? 4 : 2)) issue(field === 'quantity' ? 'IMPORT_QUANTITY_PRECISION' : 'IMPORT_MONEY_PRECISION', field);
          data[field] = String(number);
        }
      }
      data.reason ||= 'OPENING_STOCK_IMPORT';
      const identity = `${data.product_id || data.sku || data.barcode}\u0000${data.lot_number}`;
      if (seen.has(identity)) issue('IMPORT_DUPLICATE_ROW');
      seen.add(identity);
    } else {
      if (!data.name) issue('IMPORT_NAME_REQUIRED', 'name');
      if (type !== 'PRODUCTS') {
        for (const field of type === 'SUPPLIERS' ? ['name','code','phone','email'] : ['phone','email']) {
          const value = field === 'phone' ? (data[field] ?? '').replace(/\D/g, '') : (data[field] ?? '').toLocaleLowerCase();
          if (!value) continue;
          const identity = `${field}:${value}`;
          if (seen.has(identity)) issue('IMPORT_DUPLICATE_ROW', field);
          seen.add(identity);
        }
      }
      if (type === 'PRODUCTS') {
        if (data.stock_unit && !stockUnits.has(data.stock_unit)) issue('IMPORT_STOCK_UNIT', 'stock_unit');
        for (const [field, value] of Object.entries(data).filter(([field, value]) => ['sku', 'barcode'].includes(field) && value)) {
          const identity = `${field}:${value}`;
          if (seen.has(identity)) issue('IMPORT_DUPLICATE_ROW', field);
          seen.add(identity);
        }
      }
      if (type === 'CUSTOMERS' && data.status && !['active', 'archived'].includes(data.status)) issue('IMPORT_STATUS', 'status');
      if (type === 'CUSTOMERS' && data.locale && !['en', 'fr'].includes(data.locale)) issue('IMPORT_LOCALE', 'locale');
    }
    errors.push(...rowErrors.filter((error) => !record.errors.includes(error)));
    return { rowNumber: record.rowNumber, data, errors: rowErrors };
  });
  return { headers: parsed.headers, rows, errors, valid: errors.length === 0 && rows.length > 0 };
}
