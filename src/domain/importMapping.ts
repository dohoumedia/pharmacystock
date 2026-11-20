import { csvByteLength, parseCsvDocument, type CsvIssue } from './csv';
import { importColumns, MAX_IMPORT_CHARACTERS, previewImport, validateImportDocument, type ImportType } from './importPreview';
import { reportCsv } from './operationalReports';

export type ColumnMapping = Record<string, string>;
const aliases: Record<string, string> = {
  productname: 'name', suppliername: 'name', fullname: 'name', customername: 'name', nom: 'name', produit: 'name',
  reference: 'sku', ref: 'sku', codebarres: 'barcode', ean: 'barcode', upc: 'barcode',
  telephone: 'phone', tel: 'phone', courriel: 'email', adresse: 'address', langue: 'locale', language: 'locale',
  lot: 'lot_number', batch: 'lot_number', expiry: 'expiry_date', expiration: 'expiry_date', quantite: 'quantity', qty: 'quantity',
  cost: 'purchase_cost', prixachat: 'purchase_cost', price: 'selling_price', prixvente: 'selling_price', unite: 'stock_unit', branche: 'branch_id',
};
const key = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function recognizeColumns(headers: string[], type: ImportType): ColumnMapping {
  return Object.fromEntries(headers.map(header => {
    const field = importColumns[type].find(column => key(column) === key(header)) ?? aliases[key(header)] ?? '';
    return [header, importColumns[type].includes(field) ? field : ''];
  }));
}
export function mappedPreview(text: string, type: ImportType, mapping: ColumnMapping) {
  if (text.length > MAX_IMPORT_CHARACTERS || csvByteLength(text) > MAX_IMPORT_CHARACTERS) return { ...previewImport(text, type), originals: [] };
  const source = parseCsvDocument(text);
  const selected = source.headers.filter(header => mapping[header]);
  const destinations = selected.map(header => mapping[header]!);
  const issues: CsvIssue[] = [];
  if (source.headers.length > 30) issues.push({ rowNumber: 1, code: 'IMPORT_COLUMNS' });
  if (new Set(destinations).size !== destinations.length || destinations.some(field => !importColumns[type].includes(field))) issues.push({ rowNumber: 1, code: 'IMPORT_MAPPING_DUPLICATE' });
  const preview = validateImportDocument({ headers: destinations, records: source.records.map(row => ({ ...row, data: Object.fromEntries(selected.map(header => [mapping[header]!, row.data[header] ?? ''])) })), errors: source.errors }, type);
  const errors = [...issues, ...preview.errors];
  return { ...preview, errors, valid: !errors.length && preview.rows.length > 0, originals: source.records };
}
export function importCounts(rows: { rowNumber?: number; errors: CsvIssue[] }[], warnings: { rowNumber: number }[] = []) {
  const duplicateRows = rows.flatMap((row, index) => row.errors.some(issue => ['IMPORT_DUPLICATE_ROW','IMPORT_EXISTING'].includes(issue.code)) ? [row.rowNumber ?? index+2] : []);
  return { total: rows.length, valid: rows.filter(row => !row.errors.length).length, invalid: rows.filter(row => row.errors.length).length, warnings: new Set([...warnings.map(issue => issue.rowNumber),...duplicateRows]).size };
}
export function importTemplate(type: ImportType) {
  const examples: Record<ImportType, Record<string, string>> = {
    PRODUCTS: { name: 'Exemple, "Démo"', sku: 'DEMO-001', barcode: 'DEMO001', stock_unit: 'tablet', package_size: 'Box of 20' },
    SUPPLIERS: { name: 'Exemple, SARL', code: 'DEMO-SUP', email: 'contact@example.invalid' },
    CUSTOMERS: { name: 'Client Démo', phone: '15555550100', email: 'client@example.invalid', locale: 'fr', status: 'active' },
    OPENING_STOCK: { sku: 'DEMO-001', lot_number: 'DEMO-LOT', expiry_date: '2030-12-31', quantity: '10', purchase_cost: '1.20', selling_price: '2.50', stock_unit: 'tablet', reason: 'OPENING_STOCK_IMPORT' },
  };
  return reportCsv(importColumns[type], [examples[type]], field => field);
}
export function importErrorCsv(headers: string[], rows: { rowNumber: number; data: Record<string, string>; errors: CsvIssue[] }[], reason: (code: string) => string) {
  const extra = ['_import_row', '_import_errors'];
  while (headers.some(header => extra.includes(header))) extra.forEach((value, index) => { extra[index] = '_' + value; });
  return reportCsv([...headers, ...extra], rows.filter(row => row.errors.length).map(row => ({ ...row.data, [extra[0]!]: row.rowNumber, [extra[1]!]: row.errors.map(issue => `${issue.field ? issue.field + ': ' : ''}${reason(issue.code)}`).join(' | ') })), field => field);
}

export function formatImportValue(field: string, value: string, locale: string, currency?: string) {
  if (!value || !['quantity','purchase_cost','selling_price'].includes(field) || !Number.isFinite(Number(value))) return value;
  const money = field !== 'quantity';
  return new Intl.NumberFormat(locale, money && currency ? { style: 'currency', currency } : { minimumFractionDigits: money ? 2 : 0, maximumFractionDigits: money ? 2 : 4 }).format(Number(value));
}
