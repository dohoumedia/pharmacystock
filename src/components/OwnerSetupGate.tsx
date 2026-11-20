import { useState, type PropsWithChildren } from 'react';
import { ScrollView } from 'react-native';
import { useTranslation } from '../i18n/useTranslation';
import { useAuth } from '@/providers/AuthProvider';
import { useOrganization } from '@/providers/OrganizationProvider';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { firstUseState } from '@/domain/ownerSetup';
import { Alert, Button, Inline, Screen, Stack } from './ui';
import { FirstUseSetup } from './FirstUseSetup';
import { InvitationInbox } from './InvitationInbox';

export function OwnerSetupGate({ children }: PropsWithChildren) {
  const { t, i18n } = useTranslation(); const { user, loading: authLoading, signOut } = useAuth();
  const { organization, branches, managementBranches, loading, error, refresh, can, usingCachedData, accessUnavailable } = useOrganization();
  const { isOnline } = useConnectivity(); const [sessionError, setSessionError] = useState(false);
  if (!user || authLoading) return children;
  const state = firstUseState({ loading, error, online: isOnline, hasOrganization: Boolean(organization), hasBranch: (managementBranches ?? branches).length > 0, canManageBranches: can('branch.manage'), cached: usingCachedData });
  const noAccess = !loading && !error && (accessUnavailable || (organization && branches.length === 0 && !can('branch.manage')));
  if (state === 'ready' && !noAccess) return children;
  return <Stack style={{ flex: 1 }}><Inline wrap>
    <Button variant="ghost" label={i18n.language === 'fr' ? t('common.english') : t('common.french')} onPress={() => void i18n.changeLanguage(i18n.language === 'fr' ? 'en' : 'fr')} />
    <Button variant="ghost" label={t('auth.signOut')} onPress={() => { void signOut().catch(() => setSessionError(true)); }} />
  </Inline>
    {sessionError ? <Alert tone="danger" title={t('production.error.generic')} /> : null}
    {noAccess ? <Screen><Stack><Alert tone="warning" title={t('staffReady.noAccess')}>{t('staffReady.noAccessHint')}</Alert><Button label={t('common.retry')} disabled={!isOnline} onPress={() => void refresh()} /><InvitationInbox showEmpty={false} /></Stack></Screen> : state === 'loading' ? <Screen><Alert tone="info" title={t('common.loading')} /></Screen> : state === 'error' || state === 'offline' ? <Screen><Stack><Alert tone="warning" title={t(state === 'offline' ? 'setup.onlineRequired' : error ?? 'production.error.generic')} /><Button label={t('common.retry')} disabled={!isOnline} onPress={() => void refresh()} /></Stack></Screen> : <ScrollView contentContainerStyle={{ flexGrow: 1 }}><Screen><Stack><InvitationInbox /><FirstUseSetup key={organization?.id ?? user.id} /></Stack></Screen></ScrollView>}
  </Stack>;
}
