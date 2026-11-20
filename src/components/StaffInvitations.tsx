import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Share } from 'react-native';
import { useTranslation } from '../i18n/useTranslation';
import { useOrganization } from '@/providers/OrganizationProvider';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { cancelInvitation, inviteStaff, loadInvitations, setupErrorKey, type Invitation } from '@/services/ownerSetup';
import type { Role } from '@/services/organization';
import { validateInvitation } from '@/domain/ownerSetup';
import { invitationState, roleDescriptionKey } from '@/domain/staffAccess';
import { Alert, Button, FormField, Inline, Stack, StatusBadge, Surface, SupportingText, TextField } from './ui';

export function StaffInvitations({ roles, refreshVersion = 0 }: { roles: Role[]; refreshVersion?: number }) {
  const { t, i18n } = useTranslation(); const { isOnline } = useConnectivity();
  const { organization, branches: assigned, managementBranches, branch, usingCachedData } = useOrganization();
  const branches = managementBranches ?? assigned;
  const [email, setEmail] = useState(''); const [name, setName] = useState(''); const [roleId, setRoleId] = useState(''); const [branchId, setBranchId] = useState('');
  const [items, setItems] = useState<Invitation[]>([]); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null); const [success, setSuccess] = useState(false);
  const request = useRef(0);
  const flight = useRef(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const availableRoles = roles.filter((role) => role.code !== 'OWNER');
  const selectedRole = availableRoles.find((role) => role.id === roleId)?.id ?? availableRoles.find((role) => role.code === 'CASHIER')?.id ?? '';
  const selectedBranch = branches.find((item) => item.id === branchId)?.id ?? branch?.id ?? '';
  const load = useCallback(async () => {
    if (!organization || !isOnline) { setLoading(false); return; }
    const generation = ++request.current; setLoading(true);
    try { const next = await loadInvitations(organization.id); if (request.current === generation) { setItems(next); setCheckedAt(Date.now()); } }
    catch (cause) { if (request.current === generation) setError(setupErrorKey(cause)); }
    finally { if (request.current === generation) setLoading(false); }
  }, [organization, isOnline]);
  const cancelRequests = useCallback(() => { request.current++; }, []);
  useEffect(() => { const timer = setTimeout(() => { void load(); }, 0); return () => { clearTimeout(timer); cancelRequests(); }; }, [load, cancelRequests, refreshVersion]);
  useEffect(() => { const timer = setInterval(() => setCheckedAt(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const submit = async () => {
    if (flight.current || !organization || !isOnline || usingCachedData) return;
    const draft = { email, name, roleId: selectedRole, branchId: selectedBranch };
    const validation = validateInvitation(draft);
    if (validation) { setError(validation); setSuccess(false); return; }
    flight.current = true; setBusy(true); setError(null); setSuccess(false);
    try { await inviteStaff(organization.id, draft); setSuccess(true); await load(); }
    catch (cause) { setError(setupErrorKey(cause)); } finally { flight.current = false; setBusy(false); }
  };
  const cancel = async (id: string) => {
    if (flight.current || !isOnline || usingCachedData) return;
    flight.current = true; setBusy(true); setError(null); setSuccess(false);
    try { await cancelInvitation(id); setCancelId(null); await load(); }
    catch (cause) { setError(setupErrorKey(cause)); } finally { flight.current = false; setBusy(false); }
  };
  const reissue = async (item: Invitation) => {
    if (flight.current || !organization || !isOnline || usingCachedData) return;
    flight.current = true; setBusy(true); setError(null); setSuccess(false);
    try { await inviteStaff(organization.id, { email: item.email, name: item.display_name, roleId: item.role_id, branchId: item.branch_id }); setSuccess(true); await load(); }
    catch (cause) { setError(setupErrorKey(cause)); } finally { flight.current = false; setBusy(false); }
  };
  const share = async () => {
    try {
      // This is an explicit user-triggered share sheet; no message is sent by the app.
      const url = Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'https://pharmacystock-neon.vercel.app';
      await Share.share({ message: t('setup.shareInvitation', { pharmacy: organization?.name, url }) });
    } catch { setError('setup.errors.share'); }
  };
  return <Surface><Stack>
    <SupportingText>{t('setup.inviteTitle')}</SupportingText><SupportingText>{t('setup.inviteHint')}</SupportingText>
    <FormField label={t('setup.staffName')} required><TextField accessibilityLabel={t('setup.staffName')} value={name} onChangeText={setName} maxLength={160} editable={!busy} /></FormField>
    <FormField label={t('auth.email')} required><TextField accessibilityLabel={t('auth.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" maxLength={254} editable={!busy} /></FormField>
    <FormField label={t('organization.role')} required><Inline wrap>{availableRoles.map((role) => <Button key={role.id} label={i18n.language === 'fr' ? role.name_fr : role.name_en} variant={selectedRole === role.id ? 'primary' : 'secondary'} accessibilityState={{ selected: selectedRole === role.id }} disabled={busy} onPress={() => setRoleId(role.id)} />)}</Inline></FormField>
    <SupportingText>{t(roleDescriptionKey(availableRoles.find((role) => role.id === selectedRole)?.code))}</SupportingText>
    <FormField label={t('organization.branch')} required><Inline wrap>{branches.map((item) => <Button key={item.id} label={item.name} variant={selectedBranch === item.id ? 'primary' : 'secondary'} accessibilityState={{ selected: selectedBranch === item.id }} disabled={busy} onPress={() => setBranchId(item.id)} />)}</Inline></FormField>
    {!isOnline || usingCachedData ? <Alert tone="warning" title={t('setup.onlineRequired')} /> : null}
    {error ? <Alert tone="danger" title={t(error)} /> : null}
    {success ? <Alert tone="success" title={t('setup.invitationCreated')}>{t('setup.inviteHint')}</Alert> : null}
    <Button label={t('setup.invite')} loading={busy} disabled={!isOnline || usingCachedData} onPress={() => void submit()} />
    <Button label={t('setup.share')} variant="secondary" disabled={busy} onPress={() => void share()} />
    <SupportingText>{t('setup.invitationHistory')}</SupportingText>
    {loading ? <SupportingText>{t('common.loading')}</SupportingText> : null}
    {!items.length && !loading ? <SupportingText>{t('setup.noOutgoing')}</SupportingText> : null}
    {items.map((item) => <Stack key={item.id}>
      <SupportingText>{item.display_name} · {item.email}</SupportingText>
      <SupportingText>{branches.find((branch) => branch.id === item.branch_id)?.name ?? t('staffReady.inactiveBranch')} · {availableRoles.find((role) => role.id === item.role_id)?.[i18n.language === 'fr' ? 'name_fr' : 'name_en'] ?? t('organization.noRole')}</SupportingText>
      <StatusBadge label={t(`setup.invitationStatus.${invitationState(item, checkedAt)}`)} tone={item.status === 'accepted' ? 'success' : 'neutral'} />
      <SupportingText>{t('staffReady.invitedAt', { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(item.created_at)) })}</SupportingText>
      {item.accepted_at ? <SupportingText>{t('staffReady.acceptedAt', { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(item.accepted_at)) })}</SupportingText> : null}
      <SupportingText>{t('setup.expires', { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(item.expires_at)) })}</SupportingText>
      {invitationState(item, checkedAt) === 'pending' ? <SupportingText selectable>{t('staffReady.shareInstructions', { pharmacy: organization?.name, email: item.email, url: Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : 'https://pharmacystock-neon.vercel.app' })}</SupportingText> : null}
      {['expired','cancelled'].includes(invitationState(item, checkedAt)) ? <Button label={t('staffReady.reissue')} variant="secondary" disabled={busy || !isOnline || usingCachedData || !branches.some((branch) => branch.id === item.branch_id)} onPress={() => void reissue(item)} /> : null}
      {item.status === 'pending' ? cancelId === item.id ? <Stack><SupportingText>{t('staffReady.cancelConfirm', { email: item.email })}</SupportingText><Inline wrap><Button label={t('setup.cancelInvitation')} disabled={busy || !isOnline || usingCachedData} onPress={() => void cancel(item.id)} /><Button label={t('common.cancel')} variant="secondary" disabled={busy} onPress={() => setCancelId(null)} /></Inline></Stack> : <Button label={t('setup.cancelInvitation')} variant="ghost" disabled={busy || !isOnline || usingCachedData} onPress={() => setCancelId(item.id)} /> : null}
    </Stack>)}
    <Button label={t('setup.refreshInvitations')} variant="secondary" disabled={!isOnline || busy || loading} onPress={() => { setError(null); void load(); }} />
  </Stack></Surface>;
}
