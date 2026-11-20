import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from '../i18n/useTranslation';
import { Alert, Button, FormField, StatusBadge, Surface, TextField } from './ui';
import { setSupplierActive, updateSupplier, type Supplier } from '@/services/purchasing';
import { errorPresentationKey } from '../utils/errorPresentation';

export function SupplierMaintenance({ suppliers, initialSupplierId, organizationId, writable, onSaved, onOrders }: { suppliers: Supplier[]; initialSupplierId?: string | null; organizationId: string; writable: boolean; onSaved: () => Promise<void>; onOrders: (supplier: Supplier) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(''); const [selected, setSelected] = useState<Supplier | null>(() => suppliers.find((item) => item.id === initialSupplierId) ?? null);
  const [editing, setEditing] = useState(false); const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false); const flight = useRef(false);
  const [error, setError] = useState<string | null>(null); const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({ name: selected?.name ?? '', code: selected?.code ?? '', phone: selected?.phone ?? '', email: selected?.email ?? '', address: selected?.address ?? '' });
  const open = (supplier: Supplier) => { setSelected(supplier); setEditing(false); setConfirm(false); setSaved(false); setError(null); setForm({ name: supplier.name, code: supplier.code ?? '', phone: supplier.phone ?? '', email: supplier.email ?? '', address: supplier.address ?? '' }); };
  const mutate = async (archive = false) => {
    if (!selected || !writable || flight.current) return;
    if (!archive && !form.name.trim()) { setError(t('purchaseReady.supplierRequired')); return; }
    flight.current = true; setBusy(true); setError(null);
    try {
      const supplier = archive ? await setSupplierActive(organizationId, selected.id, selected.status !== 'active') : await updateSupplier({ organizationId, supplierId: selected.id, ...form });
      setSelected(supplier); setEditing(false); setConfirm(false); setSaved(true); await onSaved();
    } catch (cause) { setError(t(errorPresentationKey(cause))); }
    finally { flight.current = false; setBusy(false); }
  };
  const matching = suppliers.filter((item) => `${item.name} ${item.code ?? ''} ${item.phone ?? ''} ${item.email ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <Surface style={{ gap: 12 }}>
    <Text accessibilityRole="header">{t('purchasing.suppliers')}</Text>
    <TextField accessibilityLabel={t('purchaseReady.supplierSearch')} placeholder={t('purchaseReady.supplierSearch')} value={query} onChangeText={setQuery} />
    {!matching.length ? <Text>{t('purchasing.noSuppliers')}</Text> : matching.map((item) => <View key={item.id} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}><Button variant="secondary" label={item.name} disabled={busy} onPress={() => open(item)} /><StatusBadge label={t(`purchaseReady.supplierStatus.${item.status}`, { defaultValue: t('production.purchasingView.supplierStatus.unavailable') })} tone={item.status === 'active' ? 'success' : 'neutral'} /></View>)}
    {selected ? <Surface tone="inset" style={{ gap: 12 }}><Text accessibilityRole="header">{t('purchaseReady.supplierDetails')}: {selected.name}</Text>
      {saved ? <Alert tone="success" title={t('purchaseReady.supplierSaved')} /> : null}{error ? <Alert tone="danger" title={error} /> : null}
      {(['name', 'code', 'phone', 'email', 'address'] as const).map((field) => {
        const label = t(field === 'name' ? 'purchasing.supplierName' : field === 'phone' ? 'organization.phone' : field === 'email' ? 'auth.email' : field === 'code' ? 'purchaseReady.supplierCode' : 'purchaseReady.address');
        return <FormField key={field} label={label}>{editing ? <TextField accessibilityLabel={label} value={form[field]} editable={!busy} onChangeText={(value) => setForm((current) => ({ ...current, [field]: value }))} /> : <Text>{selected[field] || '—'}</Text>}</FormField>;
      })}
      {selected.status !== 'active' ? <Alert tone="info" title={t('purchaseReady.inactive')} /> : null}
      <Button variant="secondary" label={t('purchaseReady.supplierOrders')} disabled={busy} onPress={() => onOrders(selected)} />
      {writable ? editing ? <><Button label={t('common.save')} loading={busy} onPress={() => void mutate()} /><Button variant="ghost" label={t('common.cancel')} disabled={busy} onPress={() => open(selected)} /></> : <><Button variant="secondary" label={t('purchaseReady.edit')} disabled={busy} onPress={() => setEditing(true)} />
        {confirm ? <><Alert tone="warning" title={t('purchaseReady.archiveConfirm', { name: selected.name })} /><Button label={t('purchaseReady.confirmArchive')} loading={busy} onPress={() => void mutate(true)} /><Button variant="ghost" label={t('common.cancel')} disabled={busy} onPress={() => setConfirm(false)} /></> : <Button variant="secondary" label={t(selected.status === 'active' ? 'purchaseReady.archive' : 'purchaseReady.restore')} disabled={busy} onPress={() => selected.status === 'active' ? setConfirm(true) : void mutate(true)} />}</> : null}
    </Surface> : null}
  </Surface>;
}
