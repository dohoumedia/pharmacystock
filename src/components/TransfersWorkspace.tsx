import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView, ScrollView, Text, View } from 'react-native';
import { useTranslation } from '../i18n/useTranslation';
import { Alert, Button, FormField, PageHeader, Surface, TextField } from './ui';
import { ReadModelStatus } from './ReadModelStatus';
import { TransferWorkbench } from './TransferWorkbench';
import { transferErrorKey, transferStatusKey } from './TransferDetails';
import { useConnectivity } from '../providers/ConnectivityProvider';
import { useOrganization } from '../providers/OrganizationProvider';
import { LocalStore } from '../offline/localStore';
import { isSnapshotStale, OPERATIONAL_READ_MODEL_MAX_AGE_MS } from '../offline/readModels';
import { listTransferWorkspace } from '../services/transferCompletion';
import { transferActionInBranch } from '../domain/transferCompletion';
import { stockUnitLabel } from '../domain/stockUnits';
import { formatInstantDateTime } from '../utils/dateFormatting';

export function TransfersWorkspace({ scope, organizationId, branchId, initialSelectedId }: { initialSelectedId?: string; scope: string; organizationId: string; branchId: string }) {
  const { t, i18n } = useTranslation();
  const { isOnline } = useConnectivity();
  const { branches, can, usingCachedData: cachedPermissions } = useOrganization();
  const replica = useMemo(() => new LocalStore(), []);
  const [workspace, setWorkspace] = useState<Awaited<ReturnType<typeof listTransferWorkspace>> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cached, setCached] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const translate = useRef(t);
  useEffect(() => { translate.current = t; }, [t]);
  const canRead = can('transfer.read');
  const writable = isOnline && !cachedPermissions;
  useEffect(() => {
    if (!canRead) return;
    let active = true;
    const key = `transfer:workspace:${scope}:${page}:${search}:${status}`;
    const timer = setTimeout(() => {
      const snapshot = replica.get<Awaited<ReturnType<typeof listTransferWorkspace>>>(key);
      setWorkspace(snapshot?.data || null); setSyncedAt(snapshot?.syncedAt || null); setCached(Boolean(snapshot)); setError(null); setLoading(isOnline);
      if (!isOnline) return;
      void listTransferWorkspace(organizationId, page, search, status).then((next) => {
        if (!active) return;
        const timestamp = new Date().toISOString();
        replica.set(key, { data: next, syncedAt: timestamp }); setWorkspace(next); setSyncedAt(timestamp); setCached(false);
      }).catch((cause: unknown) => { if (active) setError(translate.current(transferErrorKey(cause))); }).finally(() => { if (active) setLoading(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [organizationId, scope, page, search, status, isOnline, canRead, revision, replica]);
  const refresh = useCallback((id?: string) => { if (id) setSelectedId(id); setRevision((current) => current + 1); }, []);
  const number = (value: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 4 }).format(value);
  const name = (id: string) => workspace?.branches.find((row) => row.id === id)?.name || branches.find((row) => row.id === id)?.name || t('transferReady.unavailable');
  if (!canRead) return <Alert tone="danger" title={t('sprint8.transfers.permissionDenied')} />;
  return <SafeAreaView style={{ flex: 1 }}><ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 1100, width: '100%', alignSelf: 'center' }}>
    <PageHeader title={t('sprint8.transfers.title')} subtitle={t('transferReady.lifecycle')} />
    <Text>{t('transferReady.branchSwitch')}</Text>
    {!isOnline ? <Alert tone="warning" title={t('production.inventoryView.offlineReadOnly')} /> : null}
    {error ? <Alert tone="danger" title={error} /> : null}
    <ReadModelStatus loading={loading} usingCachedData={cached || !isOnline} stale={isSnapshotStale(syncedAt ? { data: null, syncedAt } : null, OPERATIONAL_READ_MODEL_MAX_AGE_MS)} syncedAt={syncedAt} hasData={Boolean(workspace?.items.length)} />
    <Surface style={{ gap: 12 }}>
      <FormField label={t('transferReady.search')}><TextField accessibilityLabel={t('transferReady.search')} value={search} onChangeText={(value) => { setSearch(value); setPage(0); }} /></FormField>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{['', 'REQUESTED', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'RECEIVED_WITH_DISCREPANCY', 'CANCELLED'].map((value) => <Button key={value} variant={status === value ? 'primary' : 'secondary'} label={value ? t(`transferReady.status.${value}`) : t('transferReady.all')} onPress={() => { setStatus(value); setPage(0); }} />)}</View>
      <Button variant="ghost" label={t('transferReady.refresh')} disabled={!isOnline || loading} onPress={() => refresh()} />
      {!workspace?.items.length && !loading ? <Text>{t('sprint8.transfers.noTransfers')}</Text> : null}
      {workspace?.items.map((transfer) => {
        const next = (['approve', 'dispatch', 'receive', 'cancel'] as const).find((action) => can(action === 'cancel' ? 'transfer.create' : `transfer.${action}`) && transferActionInBranch(transfer, action, branchId, can('branch.manage')));
        return <Surface key={transfer.id} style={{ gap: 8 }}><Text style={{ fontWeight: '800' }}>{transfer.transfer_number}</Text><Text>{t('transferReady.route', { source: name(transfer.source_branch_id), destination: name(transfer.destination_branch_id) })}</Text><Text>{t(transferStatusKey(transfer.status))} · {formatInstantDateTime(transfer.created_at, i18n.language)}</Text>
          {workspace.lines.filter((line) => line.transfer_id === transfer.id).map((line) => { const product = workspace.products.find((row) => row.id === line.product_id); return <Text key={line.id}>{product?.name || t('transferReady.unavailable')} · {workspace.batches?.find((batch) => batch.id === line.source_batch_id)?.lot_number || t('transferReady.unavailable')} · {stockUnitLabel(product?.stock_unit, t)} · {t('transferReady.requested')}: {number(Number(line.requested_quantity))} · {t('transferReady.dispatched')}: {number(Number(line.dispatched_quantity))} · {t('transferReady.received')}: {number(Number(line.received_quantity))} · {t('transferReady.difference')}: {number(Number(line.discrepancy_quantity))}</Text>; })}
          <Text>{t('transferReady.next')}: {next ? t(`transferReady.actions.${next}`) : t('transferReady.viewHistory')}</Text><Button variant="secondary" label={`${t('transferReady.open')} ${transfer.transfer_number}`} onPress={() => setSelectedId(transfer.id)} />
        </Surface>;
      })}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button variant="ghost" label={t('catalogReady.previous')} disabled={loading || page === 0} onPress={() => setPage((current) => current - 1)} /><Text>{t('catalogReady.page', { page: page + 1 })}</Text><Button variant="ghost" label={t('catalogReady.next')} disabled={loading || !workspace?.hasMore} onPress={() => setPage((current) => current + 1)} /></View>
    </Surface>
    <Button label={t('transferReady.new')} disabled={!writable || !can('transfer.create')} onPress={() => setSelectedId(null)} />
    <TransferWorkbench scope={scope} organizationId={organizationId} branchId={branchId} branches={branches} selectedId={selectedId} online={isOnline} writable={writable} manageBranches={can('branch.manage')} can={can} onSaved={refresh} />
  </ScrollView></SafeAreaView>;
}
