import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationProvider } from './OrganizationProvider';

const state = vi.hoisted(() => ({
  os: 'android', effects: [] as (() => void | (() => void))[],
  listener: vi.fn(), remove: vi.fn(), addFocus: vi.fn(), removeFocus: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useEffect: (effect: () => void | (() => void)) => { state.effects.push(effect); },
}));
vi.mock('react-native', () => ({
  Platform: { get OS() { return state.os; } },
  AppState: { addEventListener: (...args: unknown[]) => { state.listener(...args); return { remove: state.remove }; } },
}));
vi.mock('./AuthProvider', () => ({ useAuth: () => ({ user: { id: 'native-owner' } }) }));
vi.mock('./ConnectivityProvider', () => ({ useConnectivity: () => ({ isOnline: true }) }));
vi.mock('@/utils/errorPresentation', () => ({ errorPresentationKey: (error: unknown) => String(error) }));
vi.mock('@/domain/ownerSetup', async () => await import('../domain/ownerSetup'));
vi.mock('@/domain/staffAccess', async () => await import('../domain/staffAccess'));
vi.mock('@/offline/localStore', () => ({ LocalStore: class { get() { return null; } set() {} } }));
vi.mock('@/offline/readModels', () => ({ cacheOrganizationContext: vi.fn(), cacheOrganizations: vi.fn(), getCachedOrganizationContext: vi.fn(), getCachedOrganizations: vi.fn() }));
vi.mock('@/services/organization', () => ({ loadOrganizationContext: vi.fn(), loadOrganizationsForUser: vi.fn().mockResolvedValue([]), loadMembershipUnavailable: vi.fn().mockResolvedValue(false) }));

let cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); state.effects = []; cleanups = [];
});
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});
function mountEffects() {
  renderToString(<OrganizationProvider><span>child</span></OrganizationProvider>);
  for (const effect of state.effects) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }
}
describe('organization foreground listeners across native and web', () => {
  it.each(['android', 'ios'])('uses AppState without browser events on %s even when window exists', os => {
    state.os = os; vi.stubGlobal('window', {});
    expect(mountEffects).not.toThrow();
    expect(state.listener).toHaveBeenCalledWith('change', expect.any(Function));
    for (const cleanup of cleanups.splice(0)) cleanup();
    expect(state.remove).toHaveBeenCalledOnce();
  });
  it('preserves web focus registration and removes the same listener', () => {
    state.os = 'web'; vi.stubGlobal('window', { addEventListener: state.addFocus, removeEventListener: state.removeFocus });
    mountEffects();
    expect(state.addFocus).toHaveBeenCalledWith('focus', expect.any(Function));
    const handler = state.addFocus.mock.calls[0]![1];
    for (const cleanup of cleanups.splice(0)) cleanup();
    expect(state.removeFocus).toHaveBeenCalledWith('focus', handler);
    expect(state.remove).toHaveBeenCalledOnce();
  });
});
