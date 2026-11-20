import { useCallback, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from '../i18n/useTranslation';
import { setupSteps, type SetupStep } from '@/domain/ownerSetup';
import { useOrganization } from '@/providers/OrganizationProvider';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { loadSetupProgress, setupErrorKey } from '@/services/ownerSetup';
import { Alert, Button, Stack, StatusBadge, Surface, SupportingText } from './ui';

const destinations: Record<SetupStep, string> = { pharmacy: '/', branch: '/branches', staff: '/staff', supplier: '/suppliers', product: '/products', purchase: '/purchasing' };

export function SetupChecklist() {
  const { t } = useTranslation(); const { organization, branch, role } = useOrganization(); const { isOnline } = useConnectivity();
  const [progress, setProgress] = useState<Record<SetupStep, boolean> | null>(null);
  const [expanded, setExpanded] = useState(false); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  const request = useRef(0);
  const load = useCallback(async () => {
    if (!organization || !branch || role?.code !== 'OWNER' || !isOnline) { setLoading(false); return; }
    const generation = ++request.current; setLoading(true); setError(null);
    try { const next = await loadSetupProgress(organization.id, branch.id); if (request.current === generation) setProgress(next); }
    catch (cause) { if (request.current === generation) setError(setupErrorKey(cause)); } finally { if (request.current === generation) setLoading(false); }
  }, [organization, branch, role?.code, isOnline]);
  useFocusEffect(useCallback(() => { setProgress(null); void load(); return () => { request.current++; }; }, [load]));
  if (!organization || !branch || role?.code !== 'OWNER') return null;
  const steps = progress ? setupSteps(progress) : [];
  const complete = steps.length > 0 && steps.every((step) => step.complete);
  return <Surface><Stack>
    <SupportingText>{t(complete ? 'setup.checklistComplete' : 'setup.checklist')}</SupportingText>
    <SupportingText>{t('setup.checklistHint')}</SupportingText>
    {loading ? <SupportingText>{t('common.loading')}</SupportingText> : null}
    {error ? <Alert tone="warning" title={t(error)} /> : null}
    {!isOnline ? <Alert tone="info" title={t('setup.checklistOffline')} /> : null}
    {complete ? <Button label={t(expanded ? 'setup.collapse' : 'setup.expand')} variant="ghost" onPress={() => setExpanded(!expanded)} /> : null}
    {!complete || expanded ? steps.map((step) => <Stack key={step.id}>
      <StatusBadge label={`${t(`setup.steps.${step.id}`)} · ${t(step.complete ? 'setup.done' : 'setup.todo')}`} tone={step.complete ? 'success' : 'neutral'} />
      {!step.complete ? <Button label={t(`setup.steps.${step.id}`)} variant="secondary" onPress={() => router.push(destinations[step.id] as '/')} /> : null}
    </Stack>) : null}
    {!complete ? <Button label={t('setup.refreshProgress')} variant="ghost" disabled={!isOnline || loading} onPress={() => void load()} /> : null}
  </Stack></Surface>;
}
