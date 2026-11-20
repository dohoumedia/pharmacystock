import { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { useTranslation } from '../i18n/useTranslation';
import { Button, Stack } from './ui';
import { CustomerDirectory } from './CustomerDirectory';
import { CustomerEditor } from './CustomerEditor';
import type { Customer } from '../services/coreCompletion';
export function PosCustomerPicker({ organizationId, userId, online, writable, canManage, locked, customerId, customer, onSelect, onEditingChange }: { organizationId: string; userId: string; online: boolean; writable: boolean; canManage: boolean; locked: boolean; customerId: string | null; customer: Customer | null; onSelect: (customer: Customer | null) => void; onEditingChange?: (editing: boolean) => void }) {
  const { t } = useTranslation(); const [open, setOpen] = useState(false); const [creating, setCreating] = useState(false);
  const editingChange = useRef(onEditingChange);
  useEffect(() => { editingChange.current = onEditingChange; }, [onEditingChange]);
  useEffect(() => () => editingChange.current?.(false), []);
  const select = (value: Customer | null) => { if (locked) return; onSelect(value); setOpen(false); setCreating(false); onEditingChange?.(false); };
  return <Stack><Text accessibilityRole="header">{t('sprint7.customers.title')}</Text>
    <Text>{customerId ? `${t('customersReady.selected')}: ${customer?.full_name ?? t('customersReady.linkedCustomer')}` : t('customersReady.walkIn')}</Text>
    <Button label={t('customersReady.choose')} variant="secondary" disabled={locked || creating} onPress={() => { setOpen(v => !v); setCreating(false); }} />
    {customerId ? <Button label={t('customersReady.clear')} variant="secondary" disabled={locked || creating} onPress={() => select(null)} /> : null}
    {open ? <>{canManage ? <Button label={t('customersReady.create')} disabled={locked || !writable || creating} onPress={() => { setCreating(true); onEditingChange?.(true); }} /> : <Text>{t('customersReady.manageRequired')}</Text>}
      {creating ? <CustomerEditor organizationId={organizationId} userId={userId} writable={writable && !locked} onSaved={select} onExisting={select} onCancel={() => { setCreating(false); onEditingChange?.(false); }} /> : <CustomerDirectory organizationId={organizationId} userId={userId} online={online} allowArchived={false} disabled={locked} onSelect={select} />}
    </> : null}
  </Stack>;
}
