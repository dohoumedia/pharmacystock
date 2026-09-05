import type { ComponentProps, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';

let windowWidth = 1440;
let pathname = '/inventory';
let french = false;

vi.mock('expo-router', () => ({
  Link: ({ children }: { children: ReactNode }) => children,
  router: { replace: vi.fn() },
  usePathname: () => pathname,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => french && key === 'production.navigation.purchasing' ? 'Achats et réceptions avec un libellé français long' : key }),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

vi.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'qa-user' }, signOut: vi.fn() }),
}));

vi.mock('@/providers/OrganizationProvider', () => ({
  useOrganization: () => ({
    organization: { name: 'QA Pharmacy' },
    branch: { name: 'Main Branch' },
    can: (permission: string) => permission !== 'customer.read',
  }),
}));

vi.mock('@/theme/tokens', () => ({
  breakpoints: { narrow: 480, compact: 640, tablet: 900, desktop: 1200 },
  palette: {
    navy: { 900: '#012', 700: '#234', 600: '#345' },
    teal: { 400: '#0be' },
    neutral: { 200: '#dde' },
  },
  colors: {
    background: '#fff', surface: '#fff', text: '#000', muted: '#666', border: '#ddd', primary: '#123', accent: '#0be',
  },
  border: { subtle: '#eee', default: '#ddd' },
  borderWidths: { hairline: 1, focus: 2 },
  disabledOpacity: 0.48,
  focusRing: { color: '#0be', width: 2 },
  foreground: { primary: '#000', secondary: '#666', inverse: '#fff' },
  shape: { sm: 8, md: 12 },
  surface: { canvas: '#fafafa', default: '#fff' },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  touchTarget: 44,
  typography: { body: {}, supporting: {}, metadata: {}, cardTitle: {} },
}));

vi.mock('./SyncStatusBadge', () => ({ SyncStatusBadge: () => <span>sync-status</span> }));

vi.mock('react-native', async () => {
  const React = await import('react');
  const element = (tag: string) => function MockElement({ children, ...props }: ComponentProps<'div'>) {
    return React.createElement(tag, props, children);
  };

  return {
    Pressable: ({
      accessibilityRole,
      accessibilityLabel,
      accessibilityState,
      focusable,
      children,
      style,
      ...props
    }: ComponentProps<'button'> & {
      accessibilityRole?: string;
      accessibilityLabel?: string;
      accessibilityState?: { selected?: boolean };
      focusable?: boolean;
    }) => {
      if (Array.isArray(style)) throw new Error('Link asChild received a style array');
      return React.createElement('button', {
        ...props,
        role: accessibilityRole,
        'aria-label': accessibilityLabel,
        'aria-selected': accessibilityState?.selected,
        tabIndex: focusable ? 0 : undefined,
      }, children);
    },
    ScrollView: element('nav'),
    Text: element('span'),
    View: element('div'),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (styles: unknown[]) => Object.assign({}, ...styles.filter(Boolean)),
    },
    useWindowDimensions: () => ({ width: windowWidth, height: 900, scale: 1, fontScale: 1 }),
  };
});

describe('authenticated AppShell navigation', () => {
  beforeEach(() => {
    pathname = '/inventory';
    french = false;
  });

  it.each([
    ['desktop sidebar', 1440],
    ['tablet rail', 900],
    ['mobile bottom navigation', 390],
  ])('renders the %s without passing style arrays through Link asChild', (_layout, width) => {
    windowWidth = width;

    const markup = renderToStaticMarkup(<AppShell><main>inventory-screen</main></AppShell>);

    expect(markup).toContain('inventory-screen');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('role="link"');
    expect(markup).toContain('tabindex="0"');
  });

  it('keeps permission-filtered destinations out of authenticated navigation', () => {
    windowWidth = 1440;

    const markup = renderToStaticMarkup(<AppShell><main>inventory-screen</main></AppShell>);

    expect(markup).not.toContain('production.navigation.customers');
  });

  it('keeps desktop navigation in the expected visual and keyboard order', () => {
    windowWidth = 1440;

    const markup = renderToStaticMarkup(<AppShell><main>inventory-screen</main></AppShell>);
    const home = markup.indexOf('production.navigation.home');
    const pos = markup.indexOf('production.navigation.pos');
    const inventory = markup.indexOf('production.navigation.inventory');

    expect(home).toBeGreaterThanOrEqual(0);
    expect(home).toBeLessThan(pos);
    expect(pos).toBeLessThan(inventory);
  });

  it('labels icon-only tablet navigation for assistive technology', () => {
    windowWidth = 900;

    const markup = renderToStaticMarkup(<AppShell><main>inventory-screen</main></AppShell>);

    expect(markup).toContain('aria-label="production.navigation.inventory"');
  });

  it('keeps the pharmacy and branch context, sign-out, and sync status visible in the shell', () => {
    windowWidth = 1440;
    const markup = renderToStaticMarkup(<AppShell><main>inventory-screen</main></AppShell>);

    expect(markup).toContain('QA Pharmacy');
    expect(markup).toContain('Main Branch');
    expect(markup).toContain('auth.signOut');
    expect(markup).toContain('sync-status');
  });

  it('preserves a visible selected state and an independent focus border composition', () => {
    windowWidth = 1440;
    const markup = renderToStaticMarkup(<AppShell><main>inventory-screen</main></AppShell>);

    expect(markup).toContain('aria-selected="true"');
    expect(markup).not.toContain('E6FFFB');
  });

  it('keeps long French navigation labels in the accessible tree', () => {
    french = true;
    pathname = '/purchasing';
    windowWidth = 1440;
    const markup = renderToStaticMarkup(<AppShell><main>purchasing-screen</main></AppShell>);

    expect(markup).toContain('Achats et réceptions avec un libellé français long');
  });
});
