import { Text, View } from 'react-native';
import { useTranslation } from '../i18n/useTranslation';
import { Button, Surface } from './ui';
import { reportColumns, financeColumns, type OperationalReport, type ReportKind, type ReportRow } from '../domain/operationalReports';
import { stockUnitLabel } from '../domain/stockUnits';
import { formatDateOnly } from '../utils/dateFormatting';
const codes = new Set(['status', 'method', 'attention', 'risk', 'movement_type', 'source', 'reference_type']);
const prices = new Set(['amount', 'purchase_cost', 'selling_price', 'cost_value', 'retail_value', 'ordered_value', 'received_value', 'outstanding_value']);
export function ReportRows({ report, kind, currency, branches, onOpen }: { report: OperationalReport; kind: ReportKind; currency: string; branches: { id: string; name: string }[]; onOpen: (row: ReportRow) => void }) {
  const { t, i18n } = useTranslation();
  const columns = reportColumns[kind].filter(key => !['id', 'sale_id', 'batch_id'].includes(key) && (report.summary.finance !== false || !financeColumns.has(key)));
  const format = (key: string, row: ReportRow): string => {
    const value = row[key];
    if (value === null || value === undefined) return t('reportsReady.unavailable');
    if (key === 'stock_unit') return stockUnitLabel(String(value), t);
    if (key === 'expiry_date') return formatDateOnly(String(value), i18n.language);
    if (key === 'timestamp' || key === 'counted_at') return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short', timeZone: report.timezone }).format(new Date(String(value)));
    if (key.endsWith('_branch_id')) return branches.find(b => b.id === value)?.name ?? String(value);
    if (codes.has(key)) return t(`reportsReady.values.${value}`, { defaultValue: String(value) });
    if (typeof value === 'boolean') return t(value ? 'reportsReady.yes' : 'reportsReady.no');
    if (typeof value === 'number' && prices.has(key) && !row.currency_code && !currency) return '—';
    if (typeof value === 'number') return new Intl.NumberFormat(i18n.language, prices.has(key) ? { style: 'currency', currency: String(row.currency_code || currency) } : { maximumFractionDigits: 4 }).format(value);
    return String(value);
  };
  return <View style={{ gap: 12 }}>{report.rows.length ? report.rows.map(row => <Surface key={row.id} style={{ gap: 8 }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{columns.map(key => <View key={key} style={{ minWidth: 130, maxWidth: '100%', flexBasis: 170, flexGrow: 1 }}><Text style={{ fontSize: 12 }}>{t(`reportsReady.columns.${key}`)}</Text><Text style={{ fontWeight: '600' }}>{format(key, row)}</Text></View>)}</View>
    <Button variant="secondary" label={t('reportsReady.open', { reference: row.reference || row.product || row.id })} onPress={() => onOpen(row)} />
  </Surface>) : <Text>{t(`reportsReady.empty.${kind}`)}</Text>}</View>;
}
