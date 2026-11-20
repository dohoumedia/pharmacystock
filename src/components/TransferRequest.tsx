import { useRef, useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { Text, View } from 'react-native';
import { useTranslation } from '../i18n/useTranslation';
import { Alert, Button, FormField, Surface, TextField } from './ui';
import { CatalogSelector } from './CatalogSelector';
import { stockUnitLabel } from '../domain/stockUnits';
import { transferEligibleQuantity, transferQuantity, type TransferContext, type TransferOperation } from '../domain/transferCompletion';
import { loadInventoryBatch } from '../services/inventoryCompletion';
import { searchTransferBatches, searchTransferDestinations } from '../services/transferCompletion';
import { transferErrorKey } from './TransferDetails';

export function TransferRequest({ organizationId, branchId, branches, disabled, onReview }: { organizationId: string; branchId: string; branches: { id: string; name: string; status: string }[]; disabled: boolean; onReview: (operation: TransferOperation) => void }) {
  const { t, i18n } = useTranslation();
  const [source, setSource] = useState(branchId);
  const [destination, setDestination] = useState('');
  const [destinationName, setDestinationName] = useState('');
  const [entries, setEntries] = useState<(TransferContext & { raw: string })[]>([]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const selection = useRef(0);
  const number = (value: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 4 }).format(value);
  const select = async (id: string) => {
    const ticket = ++selection.current; setLoading(true); setError(null);
    try {
      const context = await loadInventoryBatch(organizationId, source, id);
      if (ticket === selection.current) {
        transferQuantity('0.0001', context, organizationId, source, destination);
        setEntries((current) => current.some((entry) => entry.batch.id === id) ? current : [...current, { ...context, raw: '' }]);
      }
    } catch (cause) { if (ticket === selection.current) setError(t(transferErrorKey(cause))); }
    finally { if (ticket === selection.current) setLoading(false); }
  };
  const review = () => {
    setError(null);
    try {
      if (!entries.length) throw new Error('TRANSFER_LINES_REQUIRED');
      const key = randomUUID();
      const lines = entries.map((entry) => ({ source_batch_id: entry.batch.id, quantity: transferQuantity(entry.raw, entry, organizationId, source, destination) }));
      onReview({ organizationId, branchId, sourceBranchId: source, destinationBranchId: destination, action: 'request', key, transferNumber: `TR-${key.toUpperCase()}`, createdAt: new Date().toISOString(), phase: 'prepared', lines, notes, sourceName: branches.find((row) => row.id === source)?.name, destinationName, labels: entries.map((entry, index) => ({ product: entry.batch.product_name, lot: entry.batch.lot_number, unit: entry.batch.stock_unit, quantity: lines[index]!.quantity })) });
    } catch (cause) { setError(t(transferErrorKey(cause))); }
  };
  return <Surface style={{ gap: 12 }}><Text accessibilityRole="header" style={{ fontWeight: '800', fontSize: 20 }}>{t('transferReady.new')}</Text><Text>{t('transferReady.bound')}</Text>
    <Text>{t('transferReady.snapshotHint')}</Text>
    {error ? <Alert tone="danger" title={error} /> : null}
    <Text>{t('transferReady.source')}</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{branches.filter((row) => row.status === 'active').map((row) => <Button key={row.id} variant={source === row.id ? 'primary' : 'secondary'} label={row.name} disabled={disabled} onPress={() => { selection.current++; setSource(row.id); setEntries([]); setLoading(false); setError(null); if (destination === row.id) { setDestination(''); setDestinationName(''); } }} />)}</View>
    <CatalogSelector label={t('transferReady.destination')} scope={`destinations:${organizationId}:${source}`} disabled={disabled} selectedLabel={destinationName || undefined} load={(search, page) => searchTransferDestinations(organizationId, source, search, page)} renderLabel={(row) => row.name} onSelect={(row) => { selection.current++; setLoading(false); setDestination(row.id); setDestinationName(row.name); }} />
    {destination ? <CatalogSelector label={t('transferReady.batchSearch')} scope={`${organizationId}:${source}:${destination}`} disabled={disabled || loading} load={(search, page) => searchTransferBatches(organizationId, source, search, page)} renderLabel={(batch) => `${batch.product_name} · ${batch.lot_number}`} onSelect={(batch) => void select(batch.id)} /> : <Text>{t('transferReady.chooseBranches')}</Text>}
    {loading ? <Text>{t('common.loading')}</Text> : null}
    {entries.map((entry) => <Surface key={entry.batch.id} style={{ gap: 8 }}><Text style={{ fontWeight: '700' }}>{entry.batch.product_name} · {entry.batch.lot_number}</Text><Text>{t('transferReady.eligible')}: {transferEligibleQuantity(entry.batch, entry.balance) === null ? '—' : number(transferEligibleQuantity(entry.batch, entry.balance)!)} {stockUnitLabel(entry.batch.stock_unit, t)}</Text><FormField label={t('transferReady.requested')}><TextField accessibilityLabel={`${t('transferReady.requested')} ${entry.batch.lot_number}`} editable={!disabled} keyboardType="decimal-pad" value={entry.raw} onChangeText={(raw) => setEntries((current) => current.map((row) => row.batch.id === entry.batch.id ? { ...row, raw } : row))} /></FormField><Button variant="ghost" label={t('transferReady.remove')} disabled={disabled} onPress={() => setEntries((current) => current.filter((row) => row.batch.id !== entry.batch.id))} /></Surface>)}
    <FormField label={t('transferReady.notes')}><TextField accessibilityLabel={t('transferReady.notes')} editable={!disabled} value={notes} onChangeText={setNotes} /></FormField>
    <Button label={t('transferReady.reviewRequest')} disabled={disabled || loading} onPress={review} />
  </Surface>;
}
