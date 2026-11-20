import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectivityProvider, useConnectivity } from './ConnectivityProvider';
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('@/lib/env', () => ({ env: { supabaseUrl: 'http://127.0.0.1', supabasePublishableKey: 'fictional' } }));
function Status() {
  const { state, isOnline } = useConnectivity();
  return <span>{state}:{String(isOnline)}</span>;
}
afterEach(() => vi.unstubAllGlobals());
describe('connectivity initial render', () => {
  it.each([undefined, { onLine: true }, { onLine: false }])('starts with the same checking state for navigator=%j', (navigator) => {
    vi.stubGlobal('navigator', navigator);
    expect(renderToString(<ConnectivityProvider><Status /></ConnectivityProvider>)).toBe('<span>checking<!-- -->:<!-- -->false</span>');
  });
});
