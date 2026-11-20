import { useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Stack, Surface, SupportingText } from './ui';
import { useTranslation } from '../i18n/useTranslation';
import { settingsErrorKey } from '../domain/businessSettings';
/** Each section writes one existing record. Retry preserves the same values and record key. */
export function SettingsSection({ title, allowed, save, children, valueKey }: { title: string; allowed: boolean; save: () => Promise<void>; children: (busy: boolean) => ReactNode; valueKey: string }) {
  const { t } = useTranslation(); const inFlight = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [savedKey, setSavedKey] = useState<string | null>(null);
  const submit = async () => {
    if (inFlight.current || !allowed) return;
    inFlight.current = true; setBusy(true); setError(''); setSavedKey(null);
    try { await save(); setSavedKey(valueKey); } catch (cause) { setError(settingsErrorKey(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <Surface><Stack><SupportingText accessibilityRole="header">{title}</SupportingText>{children(busy)}
    {error ? <Alert tone="danger" title={t(error)} /> : null}{savedKey === valueKey ? <Alert tone="success" title={t('settingsReady.saved')} /> : null}
    <Button label={t(error ? 'settingsReady.retrySave' : 'common.save')} disabled={!allowed} loading={busy} onPress={() => void submit()} />
  </Stack></Surface>;
}
