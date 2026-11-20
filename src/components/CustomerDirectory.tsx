import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from '../i18n/useTranslation';
import { Alert, Button, FormField, Stack, Surface, TextField } from './ui';
import { ReadModelStatus } from './ReadModelStatus';
import { customerPage } from '../services/customerWorkflow';
import type { Customer } from '../services/coreCompletion';
import { LocalStore } from '../offline/localStore';
import { isSnapshotStale, OPERATIONAL_READ_MODEL_MAX_AGE_MS } from '../offline/readModels';
const cache = new LocalStore();
type Page = Awaited<ReturnType<typeof customerPage>>;
export function CustomerDirectory({ organizationId, userId, online, revision = 0, allowArchived = true, disabled = false, onSelect }: { organizationId: string; userId: string; online: boolean; revision?: number; allowArchived?: boolean; disabled?: boolean; onSelect: (customer: Customer) => void }) {
  const { t } = useTranslation(); const [search, setSearch] = useState(''); const [status, setStatus] = useState<Customer['status']>('active');
  const [filter, setFilter] = useState({ search: '', status, page: 0, refresh: 0 });
  const [result, setResult] = useState<Page>({ items: [], hasMore: false }); const [loading, setLoading] = useState(true); const [error, setError] = useState(false); const [cached, setCached] = useState(false); const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const cacheKey = `customer-page:${userId}:${organizationId}:${allowArchived ? 'directory' : 'pos'}`;
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true); setError(false); setResult({ items: [], hasMore: false }); setSyncedAt(null); setCached(false);
      const fallback = () => { const saved = cache.get<{ filter: typeof filter; result: Page }>(cacheKey); const matches = saved && saved.data.filter.search === filter.search && saved.data.filter.status === filter.status && saved.data.filter.page === filter.page; if (matches) { setResult(saved.data.result); setSyncedAt(saved.syncedAt); } setCached(true); };
      if (!online) { fallback(); setLoading(false); return; }
      void customerPage(organizationId, filter.search, filter.status, filter.page).then(value => {
        if (!active) return; const now = new Date().toISOString(); setResult(value); setSyncedAt(now); cache.set(cacheKey, { data: { filter, result: value }, syncedAt: now });
      }).catch(() => { if (active) { fallback(); setError(true); } }).finally(() => { if (active) setLoading(false); });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [organizationId, online, filter, revision, cacheKey]);
  const stale = isSnapshotStale(syncedAt ? { data: result, syncedAt } : null, OPERATIONAL_READ_MODEL_MAX_AGE_MS);
  return <Surface><Stack>
    <FormField label={t('customersReady.search')}><TextField accessibilityLabel={t('customersReady.search')} value={search} onChangeText={setSearch} editable={!disabled} maxLength={160} onSubmitEditing={() => setFilter(f => ({ search, status, page: 0, refresh: f.refresh + 1 }))} /></FormField>
    <Button label={t('customersReady.searchAction')} disabled={disabled || loading} onPress={() => setFilter(f => ({ search, status, page: 0, refresh: f.refresh + 1 }))} />
    {allowArchived ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{(['active', 'archived'] as const).map(value => <Button key={value} label={t(`customersReady.${value}`)} variant={status === value ? 'primary' : 'secondary'} disabled={disabled} onPress={() => { setStatus(value); setFilter(f => ({ search, status: value, page: 0, refresh: f.refresh + 1 })); }} />)}</View> : null}
    <ReadModelStatus loading={loading} usingCachedData={cached} stale={stale} syncedAt={syncedAt} hasData={!!result.items.length} />
    {error ? <Alert tone="danger" title={t('customersReady.loadFailed')} /> : null}
    {cached ? <Text>{t('customersReady.cachedPage')}</Text> : null}
    {!loading && !result.items.length ? <Text>{t(cached ? 'customersReady.noCachedPage' : 'customersReady.empty')}</Text> : null}
    {!loading ? result.items.map(customer => <View key={customer.id} style={{ gap: 8 }}><Button label={customer.full_name} accessibilityLabel={t('customersReady.open', { name: customer.full_name })} variant="secondary" disabled={disabled} onPress={() => onSelect(customer)} /><Text>{[customer.phone, customer.email].filter(Boolean).join(' · ') || t('customersReady.noContact')}</Text><Text>{t(`customersReady.${customer.status}`)}</Text></View>) : null}
    <Text>{t('posReady.page', { page: filter.page + 1 })}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}><Button label={t('posReady.previous')} variant="secondary" disabled={disabled || loading || !online || filter.page === 0} onPress={() => setFilter(f => ({ ...f, page: f.page - 1 }))} /><Button label={t('posReady.next')} variant="secondary" disabled={disabled || loading || !online || !!error || !result.hasMore} onPress={() => setFilter(f => ({ ...f, page: f.page + 1 }))} /></View>
  </Stack></Surface>;
}
