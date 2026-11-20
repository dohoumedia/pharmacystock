import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n/useTranslation';
import { useAuth } from '@/providers/AuthProvider';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { useOrganization } from '@/providers/OrganizationProvider';
import { acceptInvitation, loadIncomingInvitations, setupErrorKey, type IncomingInvitation } from '@/services/ownerSetup';
import { Alert, Button, Stack, Surface, SupportingText } from './ui';

export function InvitationInbox({ onLoaded, showEmpty = true }: { onLoaded?: (hasInvitations: boolean) => void; showEmpty?: boolean }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth(); const { isOnline } = useConnectivity(); const { refresh } = useOrganization();
  const [invitations, setInvitations] = useState<IncomingInvitation[]>([]);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const request = useRef(0);
  const flight = useRef(false);
  const load = useCallback(async () => {
    if (!isOnline) { setLoading(false); return; }
    const generation = ++request.current; setLoading(true); setError(null);
    try { const next = await loadIncomingInvitations(); if (request.current === generation) { setInvitations(next); onLoaded?.(next.length > 0); } }
    catch (cause) { if (request.current === generation) setError(setupErrorKey(cause)); } finally { if (request.current === generation) setLoading(false); }
  }, [isOnline, onLoaded]);
  const cancelRequests = useCallback(() => { request.current++; }, []);
  useEffect(() => { const timer = setTimeout(() => { setInvitations([]); void load(); }, 0); return () => { clearTimeout(timer); cancelRequests(); }; }, [load, user?.id, cancelRequests]);
  useEffect(() => { const timer = setInterval(() => setCheckedAt(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const accept = async (id: string) => {
    if (flight.current || !isOnline) return;
    flight.current = true;
    setBusy(true); setError(null);
    try { const orgId = await acceptInvitation(id); if (!await refresh(orgId)) setError('setup.refreshFailed'); else await load(); }
    catch (cause) { setError(setupErrorKey(cause)); } finally { flight.current = false; setBusy(false); }
  };
  if (!showEmpty && !loading && !error && invitations.length === 0) return null;
  return <Surface><Stack>
    <SupportingText>{t('setup.inbox')}</SupportingText>
    <SupportingText>{t('staffReady.acceptHint', { email: user?.email })}</SupportingText>
    {loading ? <SupportingText>{t('common.loading')}</SupportingText> : null}
    {!loading && !error && !invitations.length ? <SupportingText>{t('setup.noInvitations')}</SupportingText> : null}
    {invitations.map((invitation) => <Stack key={invitation.id}>
      <SupportingText>{invitation.organization_name} · {invitation.branch_name} · {i18n.language === 'fr' ? invitation.role_name_fr : invitation.role_name_en}</SupportingText>
      <SupportingText>{t('setup.expires', { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(invitation.expires_at)) })}</SupportingText>
      <Button label={t('setup.accept')} loading={busy} disabled={!isOnline || Date.parse(invitation.expires_at) <= checkedAt} onPress={() => void accept(invitation.id)} />
    </Stack>)}
    {!isOnline ? <Alert tone="warning" title={t('setup.onlineRequired')} /> : null}
    {error ? <Alert tone="danger" title={t(error)} /> : null}
    <Button variant="secondary" label={t('common.retry')} disabled={!isOnline || busy || loading} onPress={() => void load()} />
  </Stack></Surface>;
}
