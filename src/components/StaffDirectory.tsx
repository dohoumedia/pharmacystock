import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n/useTranslation';
import { useAuth } from '@/providers/AuthProvider';
import { useOrganization } from '@/providers/OrganizationProvider';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { loadAssignableRoles, loadStaff, type Role, type StaffMember } from '@/services/organization';
import { maintainStaff, staffErrorKey } from '@/services/staffAccess';
import { filterStaff, roleDescriptionKey, staffState } from '@/domain/staffAccess';
import { errorPresentationKey } from '@/utils/errorPresentation';
import { StaffInvitations } from './StaffInvitations';
import { Alert, Button, FormField, Inline, Stack, StatusBadge, Surface, SupportingText, TextField } from './ui';

type Change = { member: StaffMember; next: ReturnType<typeof staffState>; description: string };
export function StaffDirectory() {
  const { t, i18n } = useTranslation(); const { user } = useAuth(); const { isOnline } = useConnectivity();
  const { organization, managementBranches, branches: assigned, usingCachedData, can } = useOrganization();
  const branches = managementBranches ?? assigned;
  const [staff, setStaff] = useState<StaffMember[]>([]); const [roles, setRoles] = useState<Role[]>([]);
  const [query, setQuery] = useState(''); const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [error, setError] = useState<string | null>(null); const [success, setSuccess] = useState(false);
  const [change, setChange] = useState<Change | null>(null); const request = useRef(0); const flight = useRef(false);
  const writable = can('staff.manage') && isOnline && !usingCachedData;
  const load = useCallback(async () => {
    if (!organization || !isOnline) { setLoading(false); return; }
    const generation = ++request.current; setLoading(true); setError(null);
    try {
      const [members, availableRoles] = await Promise.all([loadStaff(organization.id), loadAssignableRoles(organization.id)]);
      if (generation === request.current) { setStaff(members); setRoles(availableRoles); setRefreshVersion((version) => version + 1); }
    } catch (cause) { if (generation === request.current) setError(errorPresentationKey(cause)); }
    finally { if (generation === request.current) setLoading(false); }
  }, [organization, isOnline]);
  const cancelRequests = useCallback(() => { request.current++; }, []);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => { clearTimeout(timer); cancelRequests(); }; }, [load, cancelRequests]);
  const confirm = async () => {
    if (!change || flight.current || !writable) return;
    flight.current = true; setBusy(true); setError(null); setSuccess(false);
    try { await maintainStaff(change.member, change.next); setChange(null); setSuccess(true); await load(); }
    catch (cause) { setError(staffErrorKey(cause) ?? errorPresentationKey(cause)); }
    finally { flight.current = false; setBusy(false); }
  };
  const propose = (member: StaffMember, next: ReturnType<typeof staffState>, description: string) => { setSuccess(false); setError(null); setChange({ member, next, description }); };
  const date = (value: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short', timeZone: organization?.timezone || 'UTC' }).format(new Date(value));
  const name = (member: StaffMember) => member.profile?.display_name || member.email || t('staffReady.unnamed');
  const matching = filterStaff(staff, query, status);
  const visibleStaff = change && !matching.some((member) => member.membership.id === change.member.membership.id)
    ? [...matching, staff.find((member) => member.membership.id === change.member.membership.id) ?? change.member] : matching;
  return <Stack>
    <Alert tone="info" title={t('staffReady.refreshHint')} />
    {!writable ? <Alert tone="warning" title={t('setup.onlineRequired')} /> : null}
    <StaffInvitations roles={roles} refreshVersion={refreshVersion} />
    <Inline wrap><Button label={t('setup.refreshStaff')} variant="secondary" disabled={!isOnline || loading || busy} onPress={() => void load()} /></Inline>
    <FormField label={t('staffReady.search')}><TextField accessibilityLabel={t('staffReady.search')} value={query} onChangeText={setQuery} editable={!change} /></FormField>
    <Inline wrap>{['all', 'active', 'suspended', 'revoked', 'invited'].map((value) => <Button key={value} label={t(`staffReady.status.${value}`)} variant={value === status ? 'primary' : 'secondary'} disabled={Boolean(change)} accessibilityState={{ selected: value === status }} onPress={() => setStatus(value)} />)}</Inline>
    {error ? <Alert tone="danger" title={t(error)} /> : null}
    {success ? <Alert tone="success" title={t('staffReady.saved')} /> : null}
    {loading ? <SupportingText>{t('common.loading')}</SupportingText> : null}
    {!loading && !error && visibleStaff.length === 0 ? <SupportingText>{t('staffReady.noMatches')}</SupportingText> : null}
    {visibleStaff.map((member) => {
      const protectedMember = member.membership.user_id === user?.id || member.role?.code === 'OWNER';
      const disabled = !writable || protectedMember || busy || Boolean(change) || loading;
      const roleName = member.role ? (i18n.language === 'fr' ? member.role.name_fr : member.role.name_en) : t('organization.noRole');
      const editableState = { ...staffState(member), status: member.membership.status === 'active' ? 'active' : 'suspended' };
      return <Surface key={member.membership.id}><Stack>
        <SupportingText>{name(member)}</SupportingText><SupportingText>{member.email || t('staffReady.emailUnavailable')}</SupportingText>
        <StatusBadge tone={member.membership.status === 'active' ? 'success' : 'warning'} label={t(`staffReady.status.${member.membership.status}`)} />
        <SupportingText>{t('organization.role')}: {roleName}</SupportingText><SupportingText>{t(roleDescriptionKey(member.role?.code))}</SupportingText>
        <SupportingText>{t('staffReady.joined', { date: date(member.membership.created_at) })}</SupportingText>
        <SupportingText>{t('staffReady.updated', { date: date(member.accessChangedAt || member.membership.updated_at) })}</SupportingText>
        <SupportingText>{t('organization.branchAccess')}: {member.branchIds.length ? member.branchIds.map((id) => branches.find((item) => item.id === id)?.name ?? t('staffReady.inactiveBranch')).join(', ') : t('staffReady.none')}</SupportingText>
        {['OWNER','MANAGER'].includes(member.role?.code ?? '') ? <SupportingText>{t('staffReady.managerAccess')}</SupportingText> : null}
        {change?.member.membership.id === member.membership.id ? <Stack>
          <SupportingText>{t('staffReady.confirm', { name: name(change.member) })}</SupportingText>
          <SupportingText>{change.description}</SupportingText><SupportingText>{t('staffReady.historyPreserved')}</SupportingText>
          <SupportingText>{t('staffReady.retryHint')}</SupportingText>
          {error ? <Alert tone="danger" title={t(error)} /> : null}
          <Inline wrap><Button label={t('staffReady.apply')} loading={busy} disabled={!writable} onPress={() => void confirm()} /><Button label={t('common.cancel')} variant="secondary" disabled={busy} onPress={() => setChange(null)} /></Inline>
        </Stack> : null}
        {protectedMember ? <SupportingText>{t('staffReady.protected')}</SupportingText> : <>
          <FormField label={t('staffReady.changeRole')}><Inline wrap>{roles.filter((role) => role.code !== 'OWNER').map((role) => <Button key={role.id} label={i18n.language === 'fr' ? role.name_fr : role.name_en} variant={member.membership.role_id === role.id ? 'primary' : 'secondary'} disabled={disabled || member.membership.role_id === role.id} onPress={() => propose(member, { ...editableState, role_id: role.id }, t('staffReady.roleChange', { role: i18n.language === 'fr' ? role.name_fr : role.name_en }) + ' ' + t(roleDescriptionKey(role.code)) + (['revoked','invited'].includes(member.membership.status) ? ' ' + t('staffReady.prepareSuspended') : ''))} />)}</Inline></FormField>
          <FormField label={t('organization.branchAccess')} hint={t('staffReady.branchHint')}><Inline wrap>{branches.map((branch) => {
            const selected = member.branchIds.includes(branch.id);
            return <Button key={branch.id} label={t(selected ? 'staffReady.removeBranch' : 'staffReady.addBranch', { name: branch.name })} variant={selected ? 'primary' : 'secondary'} disabled={disabled || !member.membership.role_id} onPress={() => propose(member, { ...editableState, branch_ids: selected ? member.branchIds.filter((id) => id !== branch.id) : [...member.branchIds, branch.id].sort() }, t(selected ? 'staffReady.removeBranch' : 'staffReady.addBranch', { name: branch.name }) + ' ' + t('staffReady.branchHint') + (['revoked','invited'].includes(member.membership.status) ? ' ' + t('staffReady.prepareSuspended') : ''))} />;
          })}</Inline></FormField>
          <Button label={t(member.membership.status === 'active' ? 'staffReady.deactivate' : 'staffReady.reactivate')} variant="secondary" disabled={disabled || !member.membership.role_id} onPress={() => propose(member, { ...staffState(member), status: member.membership.status === 'active' ? 'suspended' : 'active' }, t(member.membership.status === 'active' ? 'staffReady.deactivateHint' : 'staffReady.reactivateHint'))} />
        </>}
      </Stack></Surface>;
    })}
  </Stack>;
}
