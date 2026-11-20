import { describe, expect, it } from 'vitest';
import { businessDate, shiftBusinessDate, reportPeriod, validateReportFilters, reportCsv, reportFilename, reportTarget, reportColumns, type ReportFilters } from './operationalReports';
import { parseCsvDocument } from './csv';
import en from '../i18n/reportsReady.en.json';
import fr from '../i18n/reportsReady.fr.json';
const filters: ReportFilters = { report: 'sales', start: '2026-11-18', end: '2026-11-18', days: 30, search: '', supplier: '', state: '', page: 0 };
describe('business dates', () => {
  it.each([
    ['2026-11-18T04:59:59Z', 'America/Toronto', '2026-11-17'],
    ['2026-11-18T05:00:00Z', 'America/Toronto', '2026-11-18'],
    ['2026-11-18T00:00:00Z', 'UTC', '2026-11-18'],
    ['2026-11-18T23:00:00Z', 'Asia/Tokyo', '2026-11-19'],
    ['2026-03-08T06:59:59Z', 'America/New_York', '2026-03-08'],
    ['2026-03-08T07:00:00Z', 'America/New_York', '2026-03-08'],
    ['2026-11-01T06:00:00Z', 'America/New_York', '2026-11-01'],
  ])('uses configured calendar around rollover and DST: %s', (instant, zone, expected) => expect(businessDate(new Date(instant), zone)).toBe(expected));
  it('shifts calendar days rather than 24-hour local instants', () => { expect(shiftBusinessDate('2026-03-09', -1)).toBe('2026-03-08'); expect(shiftBusinessDate('2024-03-01', -1)).toBe('2024-02-29'); expect(shiftBusinessDate('2026-01-01', -1)).toBe('2025-12-31'); });
  it('validates custom ranges, filters and pagination before querying', () => { expect(() => validateReportFilters(filters)).not.toThrow(); for (const patch of [{ start: '2026-02-30' }, { end: '2026-11-17' }, { page: -1 }, { page: 1.5 }, { days: NaN }, { days: 3651 }, { search: 'x'.repeat(201) }]) expect(() => validateReportFilters({ ...filters, ...patch })).toThrow('REPORT_FILTER_INVALID'); });
});
describe('CSV export', () => {
  it('round-trips comma, quote, newline, UTF-8 and incomplete values through the import parser', () => {
    const text = reportCsv(['product', 'supplier', 'notes', 'cost', 'quantity'], [{ product: 'Médicament, "A"', supplier: 'Supplier, Montréal', notes: 'Line 1\nLine 2', cost: null, quantity: 1.25 }], k => k);
    const parsed = parseCsvDocument(new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(text)));
    expect(text.charCodeAt(0)).toBe(0xfeff); expect(text).toContain('\r\n'); expect(parsed.errors).toEqual([]);
    expect(parsed.headers).toEqual(['product', 'supplier', 'notes', 'cost', 'quantity']);
    expect(parsed.records[0]?.data).toEqual({ product: 'Médicament, "A"', supplier: 'Supplier, Montréal', notes: 'Line 1\nLine 2', cost: '', quantity: '1.25' });
  });
  it('keeps numeric values unambiguous and text cells inert in spreadsheets', () => { const parsed = parseCsvDocument(reportCsv(['amount', 'name'], [{ amount: -2.5, name: '=1+1' }], k => k)); expect(parsed.records[0]?.data).toEqual({ amount: '-2.5', name: "'=1+1" }); });
  it('preserves headers for empty exports', () => expect(parseCsvDocument(reportCsv(['a', 'b'], [], k => k)).headers).toEqual(['a', 'b']));
  it('produces contextual safe filenames', () => { expect(reportFilename('sales', 'Main / Montréal:*?', '2026-11-17', '2026-11-18')).toBe('sales-Main---Montréal----2026-11-17-2026-11-18.csv'); expect(reportFilename('inventory', '../CON<>', '2026-11-18', '2026-11-18')).not.toMatch(/[<>:"/\\|?*]/); });
});
describe('report traceability and labels', () => {
  it('opens original sales for refunds and payments, preserving the distinct refund reference', () => { for (const kind of ['sales', 'refunds', 'payments'] as const) expect(reportTarget(kind, { id: 'refund-2', sale_id: 'sale-1' })).toEqual({ kind: 'sale', id: 'sale-1' }); });
  it.each([['inventory', 'batch'], ['expiry', 'batch'], ['attention', 'product'], ['purchasing', 'order'], ['counts', 'count'], ['transfers', 'transfer'], ['movements', 'movement']] as const)('provides %s detail', (kind, target) => expect(reportTarget(kind, { id: 'record' })).toEqual({ kind: target, id: 'record' }));
  it('has matching nonempty EN/FR resources and every export column label', () => {
    const flatten = (obj: object, prefix = ''): Record<string, string> => Object.fromEntries(Object.entries(obj).flatMap(([k, v]) => typeof v === 'object' ? Object.entries(flatten(v, prefix + k + '.')) : [[prefix + k, String(v)]]));
    const a = flatten(en), b = flatten(fr); expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    for (const key of Object.keys(a)) { expect(b[key]?.trim()).toBeTruthy(); expect(b[key]?.match(/{{\w+}}/g) || []).toEqual(a[key]?.match(/{{\w+}}/g) || []); }
    for (const column of new Set(Object.values(reportColumns).flat())) { expect(en.reportsReady.columns).toHaveProperty(column); expect(fr.reportsReady.columns).toHaveProperty(column); }
  });
});

it('keeps Today/Yesterday filter application aligned after midnight even when saved draft dates are older', () => {
  expect(reportPeriod('today', '2026-11-19', '2026-11-18', '2026-11-18')).toEqual({ start: '2026-11-19', end: '2026-11-19' });
  expect(reportPeriod('yesterday', '2026-11-19', '2026-11-17', '2026-11-17')).toEqual({ start: '2026-11-18', end: '2026-11-18' });
  expect(reportPeriod('custom', '2026-11-19', '2026-11-15', '2026-11-17')).toEqual({ start: '2026-11-15', end: '2026-11-17' });
});
