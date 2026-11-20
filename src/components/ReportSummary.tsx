import { Text, View } from 'react-native';
import { useTranslation } from '../i18n/useTranslation';
import { Alert } from './ui';
import { stockUnitLabel } from '../domain/stockUnits';
import type { OperationalReport, ReportKind, PaymentMethodSummary } from '../domain/operationalReports';

const financial = ['gross', 'refunds', 'net', 'sale_count', 'refund_count', 'average', 'recorded_payments', 'payment_difference'];
const metrics: Record<ReportKind, string[]> = {
  sales: financial, refunds: financial, payments: financial,
  inventory: ['batches', 'cost_value', 'retail_value'], expiry: ['batches'],
  attention: ['low', 'out', 'no_sellable', 'unknown'],
  purchasing: ['po_count', 'open', 'draft', 'partial', 'received', 'cancelled', 'ordered_value', 'received_value', 'outstanding_value'],
  movements: ['movement_count'], counts: ['count_count', 'pending'], transfers: ['transfer_count', 'pending', 'discrepancies'],
};
const moneyMetrics = new Set(['gross', 'refunds', 'net', 'average', 'recorded_payments', 'payment_difference', 'cost_value', 'retail_value', 'ordered_value', 'received_value', 'outstanding_value']);
export function ReportSummary({ report, kind, currency, branchName, pending, conflicts }: { report: OperationalReport; kind: ReportKind; currency: string; branchName: string; pending: number; conflicts: number }) {
  const { t, i18n } = useTranslation();
  const summary = report.summary;
  const isFinancial = ['sales', 'refunds', 'payments'].includes(kind);
  const number = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 4 });
  const code = String(summary.currency_code || currency);
  const money = { format: (amount: number) => code ? new Intl.NumberFormat(i18n.language, { style: 'currency', currency: code }).format(amount) : '—' };
  return <View style={{ gap: 12 }}>
    <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: '700' }}>{isFinancial ? t(report.start === report.end ? 'reportsReady.closeout' : 'reportsReady.period') : t(`reportsReady.types.${kind}`)}</Text>
    <Text>{branchName} · {report.start} – {report.end}</Text>
    <Text>{t('reportsReady.timezone', { zone: report.timezone })}</Text>
    <Text>{t('reportsReady.columns.generated_at')}: {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short', timeZone: report.timezone }).format(new Date(report.generated_at))}</Text>
    {isFinancial ? <Text>{t('reportsReady.financialScope')}</Text> : null}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>{metrics[kind].filter(key => !(kind === 'inventory' && !summary.finance && moneyMetrics.has(key))).map(key => <View key={key} style={{ minWidth: 140, flexGrow: 1, maxWidth: 300, gap: 4 }}><Text>{t(`reportsReady.columns.${key}`)}</Text><Text style={{ fontWeight: '800', fontSize: 19 }}>{typeof summary[key] === 'number' ? (moneyMetrics.has(key) ? money : number).format(summary[key] as number) : t('reportsReady.unavailable')}</Text></View>)}</View>
    {summary.mixed_currency ? <Alert tone="warning" title={t('reportsReady.mixedCurrency')} /> : null}
    {isFinancial ? <>
      {(summary.methods as PaymentMethodSummary[] | undefined)?.map(method => <View key={method.method} style={{ gap: 3 }}><Text style={{ fontWeight: '700' }}>{t(`reportsReady.values.${method.method}`, { defaultValue: method.method })}: {money.format(method.amount)}</Text><Text>{t('reportsReady.columns.transaction_count')}: {number.format(method.transaction_count)} · {t('reportsReady.columns.reversed_count')}: {number.format(method.reversed_count)}</Text></View>)}
      {Number(summary.missing_sale_items) > 0 ? <Alert tone="warning" title={t('reportsReady.incompleteItems', { count: summary.missing_sale_items })} /> : (summary.units as { stock_unit: string; quantity: number }[] | undefined)?.map(unit => <Text key={unit.stock_unit}>{number.format(unit.quantity)} · {stockUnitLabel(unit.stock_unit, t)}</Text>)}
      <Text>{t('reportsReady.refundNote')}</Text><Text>{t('reportsReady.pendingNote', { pending, conflicts })}</Text>
    </> : null}
    {kind === 'inventory' && summary.finance && (Number(summary.missing_cost) > 0 || Number(summary.missing_price) > 0 || Number(summary.missing_balance) > 0) ? <Alert tone="warning" title={t('reportsReady.incomplete', { cost: summary.missing_cost, price: summary.missing_price, balance: summary.missing_balance })} /> : null}
    {kind !== 'inventory' && Number(summary.missing_balance) > 0 ? <Alert tone="warning" title={t('reportsReady.missingBalances', { count: summary.missing_balance })} /> : null}
    {kind === 'purchasing' ? <><Text>{t('reportsReady.purchasingScope')}</Text>{Number(summary.missing_cost) > 0 ? <Alert tone="warning" title={`${t('reportsReady.columns.missing_cost')}: ${number.format(Number(summary.missing_cost))}`} /> : null}</> : null}
    {kind === 'attention' ? <Text>{t('reportsReady.thresholdNote', { threshold: summary.threshold == null ? t('reportsReady.unavailable') : number.format(Number(summary.threshold)) })}</Text> : null}
    {kind === 'expiry' ? <Text>{t('reportsReady.expiryNote')}</Text> : null}
    {['inventory', 'attention', 'expiry'].includes(kind) ? <Text>{t('reportsReady.asOf', { date: report.business_date })}</Text> : null}
  </View>;
}
