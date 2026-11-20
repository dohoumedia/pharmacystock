import { useBusinessTimezone } from '../hooks/useBusinessTimezone';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from '../i18n/useTranslation';
import { Alert, Button, Surface } from './ui';
import { ExpiryHistoryDetail, expiryErrorKey } from './ExpiryBatchDetails';
import { loadExpiryHistory, loadExpiryActionDetail } from '../services/expiryCompletion';
import { formatInstantDateTime } from '../utils/dateFormatting';
import type { ExpiryAction } from '../services/expiry';

export function ExpiryHistory({ organizationId, branchId, branchName, online, revision }: { organizationId: string; branchId: string; branchName: string; online: boolean; revision: string | null }) {
  const { t, i18n } = useTranslation(); const timezone = useBusinessTimezone();
  const [page, setPage] = useState(0);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof loadExpiryHistory>> | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof loadExpiryActionDetail>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (!online) return;
    const ticket = ++generation.current;
    try { const next = await loadExpiryHistory(organizationId, branchId, page); if (ticket === generation.current) { setHistory(next); setError(null); } }
    catch (cause) { if (ticket === generation.current) setError(t(expiryErrorKey(cause))); }
  }, [organizationId, branchId, page, online, t]);
  useEffect(() => { const timer = setTimeout(() => void refresh(), 0); return () => { clearTimeout(timer); }; }, [refresh, revision]);
  const inspect = async (action: ExpiryAction) => {
    setDetail(null); setError(null);
    try { setDetail(await loadExpiryActionDetail(organizationId, branchId, action)); }
    catch (cause) { setError(t(expiryErrorKey(cause))); }
  };
  return <Surface style={{ gap: 12 }}><Text accessibilityRole="header" style={{ fontWeight: '800', fontSize: 20 }}>{t('expiry.recentActions')}</Text><Text>{t('organization.branch')}: {branchName}</Text>{error ? <Alert tone="danger" title={error} /> : null}{!online ? <Text>{t('expiryReady.historyOnline')}</Text> : null}<Button disabled={!online} variant="secondary" label={t('expiryReady.refreshHistory')} onPress={() => void refresh()} />
    {history?.items.length === 0 ? <Text>{t('expiry.noActions')}</Text> : null}
    {history?.items.map(({ action, productName, lot }) => <View key={action.id} style={{ gap: 4 }}><Text style={{ fontWeight: '700' }}>{productName ?? action.batch_id} · {lot ?? '—'}</Text><Text>{t(`expiry.action.${action.action_type}`)} · {formatInstantDateTime(action.created_at, i18n.language, timezone)}</Text><Text>{t('expiryReady.actionReference')}: {action.id}</Text><Text>{action.reason ?? '—'}</Text><Button disabled={!online} variant="secondary" label={t('expiryReady.inspectHistory')} onPress={() => void inspect(action)} /></View>)}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button disabled={!online || page === 0} variant="secondary" label={t('expiryReady.previous')} onPress={() => setPage((value) => value - 1)} /><Button disabled={!online || !history?.hasMore} variant="secondary" label={t('expiryReady.next')} onPress={() => setPage((value) => value + 1)} /></View>{detail ? <ExpiryHistoryDetail detail={detail} branchName={branchName} /> : null}
  </Surface>;
}
