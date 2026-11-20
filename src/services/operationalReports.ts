import { supabase } from '../lib/supabase';
import { validateReportFilters, type ReportFilters, type OperationalReport } from '../domain/operationalReports';

export async function loadOperationalReport(organizationId: string, branchId: string, filters: ReportFilters): Promise<OperationalReport> {
  validateReportFilters(filters);
  const { data, error } = await supabase.rpc('read_operational_report', {
    p_organization_id: organizationId, p_branch_id: branchId, p_report: filters.report,
    p_start: filters.start, p_end: filters.end, p_search: filters.search, p_state: filters.state,
    p_supplier: filters.supplier, p_days: filters.days, p_page: filters.page, p_product_id: filters.productId || null,
  });
  if (error) throw error;
  return data as unknown as OperationalReport;
}
export const MAX_EXPORT_ROWS = 10000;
/** Bounded export; never silently truncate. Page count/summary changes require a fresh export. */
export async function exportOperationalReport(organizationId: string, branchId: string, filters: ReportFilters, read = loadOperationalReport) {
  const first = await read(organizationId, branchId, { ...filters, page: 0 });
  if (first.total > MAX_EXPORT_ROWS) throw new Error('REPORT_EXPORT_TOO_LARGE');
  const rows = [...first.rows];
  for (let page = 1; rows.length < first.total; page++) {
    const next = await read(organizationId, branchId, { ...filters, page });
    if (next.total !== first.total || JSON.stringify(next.summary) !== JSON.stringify(first.summary) || !next.rows.length || next.business_date !== first.business_date)
      throw new Error('REPORT_CHANGED');
    rows.push(...next.rows);
    if (rows.length > MAX_EXPORT_ROWS) throw new Error('REPORT_EXPORT_TOO_LARGE');
  }
  if (rows.length !== first.total || new Set(rows.map(r => r.id)).size !== rows.length) throw new Error('REPORT_CHANGED');
  return { ...first, rows };
}

export async function readReportMovement(organizationId: string, branchId: string, id: string) {
  const { data, error } = await supabase.from('inventory_movements').select('*').eq('organization_id', organizationId).eq('branch_id', branchId).eq('id', id).single();
  if (error) throw error;
  return data;
}
