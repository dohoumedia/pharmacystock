import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportOperationalReport, loadOperationalReport, MAX_EXPORT_ROWS } from './operationalReports';
import type { OperationalReport, ReportFilters } from '../domain/operationalReports';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
const filters: ReportFilters = { report: 'sales', start: '2026-11-18', end: '2026-11-18', days: 30, search: 'quoted, text', supplier: 'Supplier, Montréal', state: '', page: 0 };
const page = (n: number, total = 61): OperationalReport => ({ rows: Array.from({ length: Math.min(25, total - n * 25) }, (_, i) => ({ id: String(n * 25 + i), amount: 1 })), total, summary: { gross: total }, timezone: 'America/Toronto', business_date: '2026-11-18', generated_at: '2026-11-18T12:00:00Z', start: filters.start, end: filters.end, branch_id: 'branch', page: n, page_size: 25 });
beforeEach(() => rpc.mockReset());
describe('query-backed reports and bounded exports', () => {
  it('passes branch, period, literal filters and page to one server-aggregated RPC', async () => { rpc.mockResolvedValue({ data: page(0), error: null }); expect((await loadOperationalReport('org', 'branch', { ...filters, page: 4 })).total).toBe(61); expect(rpc).toHaveBeenCalledWith('read_operational_report', expect.objectContaining({ p_organization_id: 'org', p_branch_id: 'branch', p_start: filters.start, p_end: filters.end, p_search: filters.search, p_supplier: filters.supplier, p_page: 4 })); });
  it('propagates incomplete reads instead of supplying zero', async () => { rpc.mockResolvedValue({ data: null, error: new Error('unavailable') }); await expect(loadOperationalReport('org', 'branch', filters)).rejects.toThrow('unavailable'); });
  it('rejects invalid pages before any read', async () => { await expect(loadOperationalReport('org', 'branch', { ...filters, page: -1 })).rejects.toThrow(); expect(rpc).not.toHaveBeenCalled(); });
  it('exports every page beyond the first 25 without loading unrelated history', async () => { const read = vi.fn(async (_org, _branch, f: ReportFilters) => page(f.page)); const report = await exportOperationalReport('org', 'branch', filters, read); expect(report.rows).toHaveLength(61); expect(read.mock.calls.map(c => c[2].page)).toEqual([0, 1, 2]); });
  it('refuses silent truncation over the explicit export bound', async () => { const read = vi.fn(async () => page(0, MAX_EXPORT_ROWS + 1)); await expect(exportOperationalReport('org', 'branch', filters, read)).rejects.toThrow('REPORT_EXPORT_TOO_LARGE'); expect(read).toHaveBeenCalledTimes(1); });
  it('rejects changed totals/summary and duplicate or missing rows', async () => { for (const altered of [{ ...page(1), total: 70 }, { ...page(1), summary: { gross: 99 } }, { ...page(1), rows: [] }, page(0)]) { const read = vi.fn().mockResolvedValueOnce(page(0)).mockResolvedValue(altered); await expect(exportOperationalReport('org', 'branch', filters, read)).rejects.toThrow('REPORT_CHANGED'); } });
  it('exports an honest empty report', async () => { const report = await exportOperationalReport('org', 'branch', filters, async () => page(0, 0)); expect(report.rows).toEqual([]); });
});
