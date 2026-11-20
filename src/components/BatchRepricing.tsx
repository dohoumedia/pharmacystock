import { useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from '../i18n/useTranslation';
import { CatalogSelector } from './CatalogSelector';
import { Alert, Button, FormField, Surface, TextField } from './ui';
import { parsePositiveSellingPrice } from '@/domain/batchPricing';
import { repriceBatch, searchBatches, type BatchChoice } from '@/services/catalogReadiness';
import { errorPresentationKey } from '@/utils/errorPresentation';
import { formatDateOnly } from '@/utils/dateFormatting';

export function BatchRepricing({ organizationId, branchId, currencyCode, onSaved }: { organizationId: string; branchId: string; currencyCode: string; onSaved: () => Promise<void> }) {
  const { t, i18n } = useTranslation(); const [batch, setBatch] = useState<BatchChoice | null>(null);
  const [price, setPrice] = useState(''); const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null); const [saved, setSaved] = useState(false);
  const [revision, setRevision] = useState(0);
  const amount = parsePositiveSellingPrice(price);
  const money = (value: number | null) => value === null || !currencyCode ? '—' : new Intl.NumberFormat(i18n.language, { style: 'currency', currency: currencyCode }).format(value);
  const submit = async () => {
    if (!currencyCode || !batch || amount === null || busy) return;
    setBusy(true); setError(null);
    try { await repriceBatch({ organizationId, branchId, batchId: batch.id, previousPrice: batch.selling_price, sellingPrice: amount }); setBatch(null); setPrice(''); setConfirm(false); setSaved(true); await onSaved(); }
    catch (cause) { setError(t(errorPresentationKey(cause))); setConfirm(false); setBatch(null); setRevision((value) => value + 1); }
    finally { setBusy(false); }
  };
  return <Surface style={{ gap: 12 }}><Text>{t('catalogReady.reprice')}</Text><Text>{t('catalogReady.repriceHint')}</Text>
    <CatalogSelector<BatchChoice> scope={`${organizationId}:${branchId}:${revision}`} label={t('catalogReady.searchBatch')} disabled={busy} selectedLabel={batch ? `${batch.product_name} / ${batch.lot_number}` : undefined} load={(query, page) => searchBatches(organizationId, branchId, query, page)} renderLabel={(item) => `${item.product_name} / ${item.lot_number} / ${formatDateOnly(item.expiry_date, i18n.language)}`} onSelect={(item) => { setBatch(item); setPrice(''); setConfirm(false); setSaved(false); }} />
    {error ? <Alert tone="danger" title={error} /> : null}{saved ? <Alert tone="success" title={t('catalogReady.saved')} /> : null}
    {batch ? <View style={{ gap: 8 }}><Text>{t('catalogReady.currentPrice', { price: money(batch.selling_price) })}</Text><FormField label={t('catalog.sellingPrice')}><TextField accessibilityLabel={t('catalog.sellingPrice')} keyboardType="decimal-pad" editable={!busy} value={price} onChangeText={(value) => { setPrice(value); setConfirm(false); }} /></FormField>
      {confirm ? <><Alert tone="warning" title={t('catalogReady.confirmPrice', { lot: batch.lot_number, price: money(amount) })} /><Button label={t('catalogReady.confirmReprice')} disabled={busy} loading={busy} onPress={() => void submit()} /><Button variant="ghost" label={t('common.cancel')} disabled={busy} onPress={() => setConfirm(false)} /></> : <Button label={t('catalogReady.reprice')} disabled={amount === null || amount === batch.selling_price} onPress={() => setConfirm(true)} />}
    </View> : null}
  </Surface>;
}
