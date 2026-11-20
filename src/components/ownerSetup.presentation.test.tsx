import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OwnerSetupGate } from './OwnerSetupGate';
import MoreScreen from '../../app/more';
import BranchesScreen from '../../app/branches';
const state = vi.hoisted(() => ({
  user: { id: 'owner' } as { id: string } | null,
  organization: null as { id: string } | null,
  branches: [] as { id: string; name: string; status: string }[],
  branch: null as { id: string } | null,
  loading: false, error: null as string | null, online: true,
  accessUnavailable: false, canManageBranches: true,
  refresh: vi.fn(async () => true), setBranchId: vi.fn(), push: vi.fn(),
  buttons: [] as { label: string; onPress?: () => void; disabled?: boolean }[],
}));
vi.mock('expo-router', () => ({ router: { push: state.push } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', changeLanguage: vi.fn() } }) }));
vi.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: state.user, loading: false, signOut: vi.fn() }) }));
vi.mock('@/providers/ConnectivityProvider', () => ({ useConnectivity: () => ({ isOnline: state.online }) }));
vi.mock('@/providers/OrganizationProvider', () => ({ useOrganization: () => ({ organization: state.organization, branches: state.branches, branch: state.branch, loading: state.loading, error: state.error, can: (permission: string) => permission === 'branch.manage' ? state.canManageBranches : true, usingCachedData: false, refresh: state.refresh, setBranchId: state.setBranchId, accessUnavailable: state.accessUnavailable }) }));
vi.mock('@/domain/ownerSetup', async () => await import('../domain/ownerSetup'));
vi.mock('@/navigation/items', async () => await import('../navigation/items'));
vi.mock('@/services/organization', () => ({ createBranch: vi.fn() }));
vi.mock('@/services/ownerSetup', () => ({ setupErrorKey: () => 'error' }));
vi.mock('./FirstUseSetup', () => ({ FirstUseSetup: () => <section>first-use-form</section> }));
vi.mock('./InvitationInbox', () => ({ InvitationInbox: () => <section>invitation-inbox</section> }));
vi.mock('react-native', () => ({
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  StyleSheet: { create: <T,>(styles: T) => styles },
}));
vi.mock('@/theme/tokens', () => ({ spacing: { lg: 16 } }));
const mockUi = vi.hoisted(() => ({ factory: async () => {
  const React = await import('react');
  const container = ({ children }: { children: ReactNode }) => React.createElement('div', null, children);
  return {
    Stack: container, Screen: container, Surface: container, Inline: container, SupportingText: container, FormField: container,
    TextField: () => React.createElement('input'),
    Alert: ({ title }: { title: string }) => React.createElement('p', null, title),
    StatusBadge: ({ label }: { label: string }) => React.createElement('span', null, label),
    PageHeader: ({ title }: { title: string }) => React.createElement('h1', null, title),
    Button: (props: { label: string; onPress?: () => void; disabled?: boolean }) => { state.buttons.push(props); return React.createElement('button', { disabled: props.disabled }, props.label); },
  };
} }));
vi.mock('./ui', mockUi.factory);
vi.mock('@/components/ui', mockUi.factory);

beforeEach(() => {
  state.user = { id: 'owner' }; state.organization = null; state.branches = []; state.branch = null;
  state.loading = false; state.error = null; state.online = true; state.buttons.length = 0; vi.clearAllMocks();
  state.accessUnavailable = false; state.canManageBranches = true;
});
describe('first-use gate rendering and recovery', () => {
  it('shows clear no-access recovery instead of pharmacy creation after deactivation', () => {
    state.accessUnavailable = true;
    const markup = renderToStaticMarkup(<OwnerSetupGate><main>app</main></OwnerSetupGate>);
    expect(markup).toContain('staffReady.noAccess'); expect(markup).not.toContain('first-use-form'); expect(markup).not.toContain('<main>app');
    state.buttons.find((button) => button.label === 'common.retry')?.onPress?.(); expect(state.refresh).toHaveBeenCalledOnce();
  });
  it('does not strand an active ordinary member with zero branches in operational screens', () => {
    state.organization = { id: 'org' }; state.canManageBranches = false;
    const markup = renderToStaticMarkup(<OwnerSetupGate><main>app</main></OwnerSetupGate>);
    expect(markup).toContain('staffReady.noAccess'); expect(markup).not.toContain('first-use-form'); expect(markup).not.toContain('<main>app');
  });
  it('preserves login before authentication', () => {
    state.user = null;
    expect(renderToStaticMarkup(<OwnerSetupGate><main>login</main></OwnerSetupGate>)).toContain('login');
  });
  it('offers setup and invitation acceptance for the authenticated no-organization state', () => {
    const markup = renderToStaticMarkup(<OwnerSetupGate><main>app</main></OwnerSetupGate>);
    expect(markup).toContain('first-use-form'); expect(markup).toContain('invitation-inbox'); expect(markup).not.toContain('<main>app');
  });
  it('does not render setup while initial organization lookup is loading', () => {
    state.loading = true;
    const markup = renderToStaticMarkup(<OwnerSetupGate><main>app</main></OwnerSetupGate>);
    expect(markup).toContain('common.loading'); expect(markup).not.toContain('first-use-form');
  });
  it('keeps an organization-context failure behind retry, rather than entering an unusable shell', async () => {
    state.organization = { id: 'org' }; state.error = 'production.error.temporary';
    const markup = renderToStaticMarkup(<OwnerSetupGate><main>app</main></OwnerSetupGate>);
    expect(markup).toContain('production.error.temporary'); expect(markup).not.toContain('<main>app');
    state.buttons.find((button) => button.label === 'common.retry')?.onPress?.();
    expect(state.refresh).toHaveBeenCalledOnce();
  });
  it('transitions from setup to the normal app after pharmacy and first branch are loaded', () => {
    expect(renderToStaticMarkup(<OwnerSetupGate><main>app</main></OwnerSetupGate>)).toContain('first-use-form');
    state.organization = { id: 'org' }; state.branches = [{ id: 'main', name: 'Main', status: 'active' }]; state.branch = { id: 'main' };
    expect(renderToStaticMarkup(<OwnerSetupGate><main>app</main></OwnerSetupGate>)).toBe('<main>app</main>');
  });
});
describe('rendered ordinary phone navigation', () => {
  it.each(['/staff', '/branches', '/suppliers', '/products', '/purchasing'])('opens %s through More', (href) => {
    const markup = renderToStaticMarkup(<MoreScreen />);
    expect(markup).toContain('setup.nav.more');
    const labels: Record<string, string> = { '/staff': 'setup.nav.staff', '/branches': 'setup.nav.branches', '/suppliers': 'setup.nav.suppliers', '/products': 'production.navigation.products', '/purchasing': 'production.navigation.purchasing' };
    state.buttons.find((button) => button.label === labels[href])?.onPress?.();
    expect(state.push).toHaveBeenCalledWith(href);
  });
  it('marks the current branch and switches through the existing provider context', () => {
    state.organization = { id: 'org' }; state.branch = { id: 'main' };
    state.branches = [{ id: 'main', name: 'Main', status: 'active' }, { id: 'north', name: 'North', status: 'active' }];
    const markup = renderToStaticMarkup(<BranchesScreen />);
    expect(markup).toContain('setup.currentBranch');
    state.buttons.find((button) => button.label === 'setup.switchBranch')?.onPress?.();
    expect(state.setBranchId).toHaveBeenCalledWith('north');
  });
});
