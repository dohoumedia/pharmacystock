import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from '../i18n/useTranslation';
import { Alert, Button, FormField, Stack, Surface, TextField } from './ui';
import { salesPage } from '../services/posCompletion';
import type { Sale } from '../services/sales';
import { validDateOnly } from '../domain/numericInput';
import { formatPosCurrency, formatPosDate, posStatusTranslationKey } from '../utils/posPresentation';
import { spacing } from '../theme/tokens';
export function SalesHistory({ organizationId, branchId, online, revision, onOpen, timezone, customerId, branchNames }: { organizationId: string; branchId: string | null; customerId?: string; branchNames?: Record<string, string>; online: boolean; revision: number; onOpen: (saleId: string, branchId: string) => void; timezone?: string }) {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState(''); const [date, setDate] = useState('');
  const [filter, setFilter] = useState({ search: '', date: '', page: 0, refresh: 0 });
  const [rows, setRows] = useState<Sale[]>([]); const [more, setMore] = useState(false); const [busy, setBusy] = useState(true); const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setBusy(true); setError('');
      if (!online) { setRows([]); setBusy(false); return; }
      void salesPage(organizationId, branchId, filter.search, filter.date, filter.page, timezone, customerId).then(result => { if (active) { setRows(result.items); setMore(result.hasMore); } }).catch(() => { if (active) setError(t('posReady.historyError')); }).finally(() => { if (active) setBusy(false); });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [organizationId, branchId, online, filter, revision, t, timezone, customerId]);
  return <Surface><Stack gap={spacing.md}><Text accessibilityRole="header">{t('pos.salesHistory')}</Text>
    <FormField label={t('posReady.searchSales')}><TextField accessibilityLabel={t('posReady.searchSales')} value={search} onChangeText={setSearch} /></FormField>
    <FormField label={t('posReady.dateFilter')}><TextField accessibilityLabel={t('posReady.dateFilter')} value={date} onChangeText={setDate} /></FormField>
    <Button label={t('posReady.searchAction')} disabled={!online || busy} onPress={() => { if (date && !validDateOnly(date)) { setError(t('posReady.invalidDate')); return; } setFilter(f => ({ search, date, page: 0, refresh: f.refresh + 1 })); }} />
    {!online ? <Alert tone="warning" title={t('posReady.offline')} /> : busy ? <Text>{t('posReady.loading')}</Text> : error ? <Alert tone="danger" title={error} /> : !rows.length ? <Text>{t('pos.noSales')}</Text> : rows.map(sale => <View key={sale.id}><Button label={sale.sale_number} variant="secondary" onPress={() => onOpen(sale.id, sale.branch_id)} />{customerId ? <Text>{t('posReady.branch')}: {branchNames?.[sale.branch_id] ?? sale.branch_id}</Text> : null}<Text>{formatPosDate(sale.completed_at, i18n.language, timezone)} · {t(posStatusTranslationKey(sale.status))} · {formatPosCurrency(Number(sale.total_amount), sale.currency_code, i18n.language)}</Text></View>)}
    <Text>{t('posReady.page', { page: filter.page + 1 })}</Text>
    <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}><Button label={t('posReady.previous')} variant="secondary" disabled={busy || !online || filter.page === 0} onPress={() => setFilter(f => ({ ...f, page: f.page - 1 }))} /><Button label={t('posReady.next')} variant="secondary" disabled={busy || !online || !!error || !more} onPress={() => setFilter(f => ({ ...f, page: f.page + 1 }))} /></View>
  </Stack></Surface>;
}
