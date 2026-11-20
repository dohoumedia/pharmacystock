import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from '../i18n/useTranslation';
import { Alert, Button, FormField, TextField } from './ui';
import { errorPresentationKey } from '@/utils/errorPresentation';
import type { Page } from '@/services/catalogReadiness';

export function CatalogSelector<T extends { id: string }>({ label, scope, selectedLabel, load, renderLabel, onSelect, disabled = false }: { label: string; scope: string; selectedLabel?: string; load: (search: string, page: number) => Promise<Page<T>>; renderLabel: (item: T) => string; onSelect: (item: T) => void; disabled?: boolean }) {
  return <ScopedCatalogSelector key={scope} label={label} scope={scope} selectedLabel={selectedLabel} load={load} renderLabel={renderLabel} onSelect={onSelect} disabled={disabled} />;
}
function ScopedCatalogSelector<T extends { id: string }>({ label, scope, selectedLabel, load, renderLabel, onSelect, disabled = false }: { label: string; scope: string; selectedLabel?: string; load: (search: string, page: number) => Promise<Page<T>>; renderLabel: (item: T) => string; onSelect: (item: T) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<T[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const loader = useRef(load);
  useEffect(() => { loader.current = load; }, [load]);
  useEffect(() => {
    let cancelled = false;
    if (disabled) return;
    const timer = setTimeout(() => {
      setItems([]); setLoading(true); setError(null);
      void loader.current(query, page).then((result) => {
        if (cancelled) return;
        setItems(result.items); setHasMore(result.hasMore);
      }).catch((cause: unknown) => { if (!cancelled) setError(t(errorPresentationKey(cause))); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); cancelled = true; };
  }, [query, page, scope, disabled, retry, t]);
  return <View style={styles.stack}>
    <FormField label={label} hint={selectedLabel ? t('catalogReady.selected', { value: selectedLabel }) : undefined}>
      <TextField accessibilityLabel={label} placeholder={t('catalogReady.search')} editable={!disabled} value={query} onChangeText={(value) => { setItems([]); setQuery(value); setPage(0); }} />
    </FormField>
    {loading ? <Text>{t('common.loading')}</Text> : null}
    {error ? <><Alert tone="danger" title={error} /><Button label={t('catalogReady.retry')} onPress={() => setRetry((value) => value + 1)} /></> : null}
    {!loading && !error && !items.length ? <Text>{t('catalogReady.noResults')}</Text> : null}
    {!disabled ? items.map((item) => <Button key={item.id} variant="secondary" label={renderLabel(item)} onPress={() => onSelect(item)} />) : null}
    <View style={styles.row}><Button variant="ghost" disabled={disabled || loading || page === 0} label={t('catalogReady.previous')} onPress={() => setPage((value) => value - 1)} /><Text>{t('catalogReady.page', { page: page + 1 })}</Text><Button variant="ghost" disabled={disabled || loading || !hasMore} label={t('catalogReady.next')} onPress={() => setPage((value) => value + 1)} /></View>
  </View>;
}
const styles = StyleSheet.create({ stack: { gap: 8 }, row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 } });
