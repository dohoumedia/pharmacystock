import type { PropsWithChildren, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RootLayout from '../../app/_layout';
import StaffScreen from '../../app/staff';

const state = vi.hoisted(() => ({
  path: '/inventory', user: { id: 'owner' } as { id: string } | null,
  authLoading: false, loading: false, organization: { id: 'org' } as { id: string } | null,
  branches: [{ id: 'main', status: 'active' }], branch: 'main',
  locale: 'en', allowed: true, error: null as string | null, noAccess: false,
  navigators: 0, redirects: [] as string[],
}));
vi.mock('@/components/OwnerSetupGate', async () => await import('../components/OwnerSetupGate'));
vi.mock('@/domain/ownerSetup', async () => await import('../domain/ownerSetup'));
vi.mock('@/components/ui', async () => await import('../components/ui'));
vi.mock('../../app/index', () => ({ default: () => <p>existing-sign-in-flow</p> }));
vi.mock('@/i18n', () => ({ activateClientLocale: vi.fn() }));
vi.mock('../i18n/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => `${state.locale}:${key}`, i18n: { language: state.locale, changeLanguage: vi.fn() } }) }));
vi.mock('@/providers/AppProviders', () => ({ AppProviders: ({ children }: PropsWithChildren) => children }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: ({ children }: PropsWithChildren) => children }));
vi.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: state.user, loading: state.authLoading, signOut: vi.fn() }) }));
vi.mock('@/providers/OrganizationProvider', () => ({ useOrganization: () => ({
  organization: state.organization, branches: state.branches, branch: { id: state.branch },
  loading: state.loading, error: state.error, refresh: vi.fn(), can: () => state.allowed,
  usingCachedData: false, accessUnavailable: state.noAccess,
}) }));
vi.mock('@/providers/ConnectivityProvider', () => ({ useConnectivity: () => ({ isOnline: true }) }));
vi.mock('@/components/AppShell', () => ({ AppShell: ({ children }: PropsWithChildren) => <section>{children}</section> }));
vi.mock('../components/FirstUseSetup', () => ({ FirstUseSetup: () => <p>setup</p> }));
vi.mock('../components/InvitationInbox', () => ({ InvitationInbox: () => <p>invitations</p> }));
vi.mock('@/components/StaffDirectory', () => ({ StaffDirectory: () => <p>private-staff-directory</p> }));
vi.mock('react-native', () => ({ ScrollView: ({ children }: PropsWithChildren) => <div>{children}</div> }));
vi.mock('../components/ui', () => ({
  Stack: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Inline: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Screen: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Alert: ({ title }: { title: string }) => <p>{title}</p>,
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  Button: ({ label }: { label: string }) => <button>{label}</button>,
}));
vi.mock('expo-router', () => ({
  usePathname: () => state.path,
  Redirect: ({ href }: { href: string }) => { state.redirects.push(href); return <p>auth-redirect</p>; },
  // Contract test: the root navigator must be rendered even when its layout
  // withholds screens. Real navigator lifetime/URL retention is browser-verified.
  Stack: ({ layout }: { layout?: (props: PropsWithChildren) => ReactNode }) => {
    state.navigators++;
    const children = state.path === '/staff' ? <StaffScreen /> : <article>{state.path}:{state.branch}:{state.locale}</article>;
    return <nav>{layout ? layout({ children }) : children}</nav>;
  },
}));
function beginHydration() { state.loading = true; state.organization = null; state.branches = []; }
function finishHydration() { state.loading = false; state.organization = { id: 'org' }; state.branches = [{ id: 'main', status: 'active' }, { id: 'annex', status: 'active' }]; }
function render() { state.navigators = 0; state.redirects = []; return renderToStaticMarkup(<RootLayout />); }
beforeEach(() => {
  Object.assign(state, { path: '/inventory', user: { id: 'owner' }, authLoading: false, loading: false,
    organization: { id: 'org' }, branches: [{ id: 'main', status: 'active' }], branch: 'main', locale: 'en', allowed: true, error: null, noAccess: false });
});
describe('direct-link root navigator lifetime contract', () => {
  it('waits for session hydration before choosing the signed-out auth flow', () => {
    state.user = null; state.authLoading = true;
    expect(render()).toContain('existing-sign-in-flow'); expect(state.navigators).toBe(1); expect(state.redirects).toEqual([]);
    state.user = { id: 'owner' }; state.authLoading = false; beginHydration();
    expect(render()).toContain('common.loading'); expect(state.navigators).toBe(1);
    finishHydration();
    expect(render()).toContain('/inventory:main:en'); expect(state.redirects).toEqual([]);
  });
  it.each(['/inventory', '/reports', '/sales', '/settings', '/purchasing?purchaseOrderId=po'])('keeps %s in the navigator through membership hydration', path => {
    state.path = path; beginHydration();
    expect(render()).not.toContain('<article>'); expect(state.navigators).toBe(1);
    finishHydration();
    expect(render()).toContain(path); expect(state.navigators).toBe(1); expect(state.redirects).toEqual([]);
  });
  it('retains authorized staff content and its existing permission denial for a cashier', () => {
    state.path = '/staff';
    expect(render()).toContain('private-staff-directory');
    state.user = { id: 'cashier' }; state.allowed = false;
    const html = render(); expect(html).toContain('organization.cannotManage'); expect(html).not.toContain('private-staff-directory');
    expect(state.redirects).toEqual([]); expect(state.navigators).toBe(1);
  });
  it.each(['/inventory', '/reports', '/staff', '/sales'])('shows existing authentication for signed-out %s without losing its URL', path => {
    state.path = path; state.user = null;
    expect(render()).toContain('existing-sign-in-flow'); expect(state.redirects).toEqual([]); expect(state.navigators).toBe(1);
  });
  it('retains the direct route when a session arrives after the existing auth fallback', () => {
    state.user = null;
    expect(render()).toContain('existing-sign-in-flow'); expect(state.redirects).toEqual([]);
    state.user = { id: 'owner' }; beginHydration();
    expect(render()).toContain('common.loading'); expect(state.navigators).toBe(1);
    finishHydration();
    expect(render()).toContain('/inventory:main:en'); expect(state.redirects).toEqual([]);
  });
  it('leaves Home authentication renderable without a redirect loop', () => {
    state.path = '/'; state.user = null;
    render(); expect(state.redirects).toEqual([]); expect(state.navigators).toBe(1);
  });
  it('keeps the navigator while the selected branch context rehydrates', () => {
    state.path = '/reports'; beginHydration(); state.branch = 'annex';
    expect(render()).not.toContain('<article>'); expect(state.navigators).toBe(1);
    finishHydration();
    expect(render()).toContain('/reports:annex:en'); expect(state.redirects).toEqual([]);
  });
  it.each(['en', 'fr'])('keeps the direct route with hydrated %s locale', locale => {
    state.path = '/reports'; state.locale = locale; beginHydration();
    expect(render()).toContain(`${locale}:common.loading`); expect(state.navigators).toBe(1);
    finishHydration();
    expect(render()).toContain(`/reports:main:${locale}`); expect(state.redirects).toEqual([]);
  });
  it.each(['error', 'no-access', 'setup'])('preserves the %s gate without removing navigation state', gate => {
    if (gate === 'error') { state.organization = null; state.error = 'production.error.temporary'; }
    if (gate === 'no-access') state.noAccess = true;
    if (gate === 'setup') { state.organization = null; state.branches = []; }
    expect(render()).not.toContain('<article>'); expect(state.navigators).toBe(1); expect(state.redirects).toEqual([]);
  });
});
