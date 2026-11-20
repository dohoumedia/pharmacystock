import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useTranslation } from '../i18n/useTranslation';
import { Alert, Button, FormField, Stack, Surface, TextField } from './ui';
import { customerDraft, customerErrorKey, validateCustomer, type CustomerAttempt } from '../domain/customerWorkflow';
import { customerDuplicates, saveCustomerAttempt } from '../services/customerWorkflow';
import type { Customer } from '../services/coreCompletion';
import { createPosAttemptStore } from '../services/posAttempts';
import { isDefinitiveRejection } from '../domain/numericInput';
const store = createPosAttemptStore();
export function CustomerEditor({ organizationId, userId, customer, writable, onSaved, onCancel, onExisting }: { organizationId: string; userId: string; customer?: Customer; writable: boolean; onSaved: (customer: Customer) => void; onCancel: () => void; onExisting: (customer: Customer) => void }) {
  const { t, i18n } = useTranslation();
  const key = `customer:${userId}:${organizationId}:${customer?.id ?? 'new'}`;
  const [pending, setPending] = useState<CustomerAttempt | null>(() => store.read<CustomerAttempt>(key));
  const [draft, setDraft] = useState(() => pending?.draft ?? customerDraft(customer, i18n.language));
  const [busy, setBusy] = useState(false); const inFlight = useRef(false);
  const [error, setError] = useState(''); const [duplicates, setDuplicates] = useState<Customer[]>([]); const [confirmStatus, setConfirmStatus] = useState(false);
  const locked = !writable || busy || !!pending;
  const change = (field: keyof typeof draft, value: string | null) => { setDraft(d => ({ ...d, [field]: value })); setError(''); setDuplicates([]); setConfirmStatus(false); };
  const save = async () => {
    if (!writable || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const attempt = pending ?? { id: customer?.id ?? randomUUID(), organizationId, originalUpdatedAt: customer?.updated_at ?? null, draft: validateCustomer(draft) };
      if (!pending) {
        const matches = await customerDuplicates(organizationId, attempt.draft, attempt.id);
        if (matches.length) { setDuplicates(matches); setError(t('customersReady.errors.CUSTOMER_DUPLICATE')); return; }
        store.save(key, attempt); setPending(attempt);
      }
      const saved = await saveCustomerAttempt(attempt);
      store.remove(key); setPending(null); onSaved(saved);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      if (message.startsWith('CUSTOMER_') || isDefinitiveRejection(cause)) {
        store.remove(key); setPending(null); setError(t(customerErrorKey(cause)));
        if (message === 'CUSTOMER_DUPLICATE') { try { setDuplicates(await customerDuplicates(organizationId, draft, customer?.id ?? '00000000-0000-0000-0000-000000000000')); } catch { /* preserve original error */ } }
      } else setError(t('customersReady.recovery'));
    } finally { inFlight.current = false; setBusy(false); }
  };
  return <Surface><Stack>
    <Text accessibilityRole="header">{t(customer ? 'customersReady.edit' : 'customersReady.create')}</Text>
    {!writable ? <Alert tone="warning" title={t('customersReady.onlineOnly')} /> : null}
    {error ? <Alert tone="danger" title={error} /> : null}
    {pending ? <><Alert tone="warning" title={t('customersReady.recovery')} /><Text>{pending.draft.full_name} · {pending.draft.phone} · {pending.draft.email} · {t(`customersReady.${pending.draft.status}`)}</Text><Button label={t('customersReady.retry')} loading={busy} disabled={!writable} onPress={() => void save()} /></> : null}
    <FormField label={t('sprint7.customers.name')} required><TextField accessibilityLabel={t('sprint7.customers.name')} value={draft.full_name} onChangeText={v => change('full_name', v)} editable={!locked} maxLength={160} /></FormField>
    <FormField label={t('sprint7.customers.phone')}><TextField accessibilityLabel={t('sprint7.customers.phone')} value={draft.phone ?? ''} onChangeText={v => change('phone', v)} editable={!locked} keyboardType="phone-pad" maxLength={40} /></FormField>
    <FormField label={t('sprint7.customers.email')}><TextField accessibilityLabel={t('sprint7.customers.email')} value={draft.email ?? ''} onChangeText={v => change('email', v)} editable={!locked} autoCapitalize="none" keyboardType="email-address" maxLength={254} /></FormField>
    <FormField label={t('sprint7.customers.notes')} hint={t('customersReady.notesHint')}><TextField accessibilityLabel={t('sprint7.customers.notes')} value={draft.notes ?? ''} onChangeText={v => change('notes', v)} editable={!locked} multiline maxLength={2000} /></FormField>
    <Text>{t('customersReady.language')}</Text><View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>{(['en', 'fr'] as const).map(locale => <Button key={locale} label={t(`customersReady.${locale}`)} variant={draft.preferred_locale === locale ? 'primary' : 'secondary'} disabled={locked} onPress={() => change('preferred_locale', locale)} />)}</View>
    {customer ? <><Text>{t(`customersReady.${draft.status}`)}</Text>{confirmStatus ? <><Text>{t('customersReady.archiveConfirm')}</Text><Button label={t('customersReady.confirmStatus')} disabled={locked} onPress={() => change('status', draft.status === 'active' ? 'archived' : 'active')} /></> : <Button label={t(draft.status === 'active' ? 'customersReady.archive' : 'customersReady.restore')} variant="secondary" disabled={locked} onPress={() => setConfirmStatus(true)} />}</> : null}
    {duplicates.length ? <><Text>{t('customersReady.duplicates')}</Text>{duplicates.map(match => <Button key={match.id} label={`${t('customersReady.useExisting')}: ${match.full_name} · ${match.phone ?? match.email ?? ''}`} variant="secondary" disabled={busy} onPress={() => onExisting(match)} />)}<Text>{t('customersReady.sharedContact')}</Text></> : null}
    {!pending ? <Button label={t('customersReady.save')} loading={busy} disabled={!writable} onPress={() => void save()} /> : null}
    <Button label={t('common.cancel')} variant="secondary" disabled={busy} onPress={onCancel} />
    <Text>{t('customersReady.historyPreserved')}</Text>
  </Stack></Surface>;
}
