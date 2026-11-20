import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));

// Run the installed CommonJS Router modules in an isolated process. Only the
// native UI barrel and URL transport are replaced. The barrel uses its actual
// path-config validator; linking config, parsing and serialization stay real.
const routingProbe = String.raw`
  const assert = require('node:assert/strict');
  const Module = require('node:module');
  const path = require('node:path');
  const root = process.argv[1];
  const router = path.dirname(require.resolve('expo-router/package.json', { paths: [root] }));
  const validate = require(path.join(router, 'build/react-navigation/core/validatePathConfig.js'));
  const originalLoad = Module._load;
  let decoderCalls = 0;
  const platform = { OS: 'web' };
  Module._load = function(request, parent, isMain) {
    if (request === 'decode-uri-component') return () => {
      decoderCalls++;
      throw new Error('VULNERABLE_DECODER_REACHED');
    };
    if (parent?.filename.startsWith(router) && /(?:^|\/)react-navigation\/native$/.test(request)) {
      return validate;
    }
    if (request === 'react-native' || request === 'expo-modules-core') return { Platform: platform };
    if (request === 'expo-linking') return {};
    if (parent?.filename === path.join(router, 'build/link/linking.js') && request === '../fork/useLinking') {
      return { getInitialURLWithTimeout: () => { throw new Error('Unexpected transport access'); } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const { getStateFromPath } = require(path.join(router, 'build/fork/getStateFromPath.js'));
  const { getPathFromState } = require(path.join(router, 'build/fork/getPathFromState.js'));
  const { appendQueryAndHash } = require(path.join(router, 'build/fork/getPathFromState-forks.js'));
  const routes = ['inventory', 'reports', 'sales', 'staff', 'settings', 'purchasing'];
  const config = { screens: Object.fromEntries(routes.map(name => [name, name])) };
  const inputs = [
    'caf%C3%A9',
    '%FF'.repeat(4096),
    Array.from({ length: 1024 }, (_, n) => '%' + n.toString(16).padStart(4, '0')).join('') + '%zz',
    '%E0%A4%A',
    '%25GG',
  ];
  let cases = 0;
  for (const name of routes) for (const locale of ['en', 'fr']) for (const input of inputs) {
    const url = '/' + name + '?locale=' + locale + '&value=' + input + '&tag=a&tag=b';
    const state = getStateFromPath(url, config);
    const route = state.routes.at(-1);
    assert.equal(route.name, name);
    assert.equal(route.params.locale, locale);
    assert.deepEqual(route.params.tag, ['a', 'b']);
    assert.equal(route.params.value, new URL(url, 'file:').searchParams.get('value'));
    const serialized = getPathFromState(state, config);
    const roundtrip = getStateFromPath(serialized, config);
    assert.equal(roundtrip.routes.at(-1).params.value, route.params.value);
    assert.equal(roundtrip.routes.at(-1).params.locale, locale);
    assert.ok(appendQueryAndHash('/' + name, { value: route.params.value }).startsWith('/' + name + '?'));
    cases++;
  }
  // Exercise the installed config factory and linking barrel too, so the test
  // checks which parser is selected instead of assuming the fork is active.
  const { getLinkingConfig } = require(path.join(router, 'build/getLinkingConfig.js'));
  const context = Object.assign(() => { throw new Error('Unexpected route import'); }, { keys: () => [] });
  const routeTree = { route: '', children: routes.map(route => ({ route, children: [] })) };
  for (const os of ['web', 'android', 'ios']) {
    platform.OS = os;
    const linking = getLinkingConfig(routeTree, context, () => ({ segments: [] }), {
      serverUrl: '/inventory?locale=fr&value=%FF', sitemap: false, notFound: false,
    });
    const state = linking.getStateFromPath(linking.getInitialURL(), linking.config);
    const focused = state.routes.at(-1).state.routes.at(-1);
    assert.equal(focused.name, 'inventory');
    assert.equal(focused.params.locale, 'fr');
    assert.ok(linking.getPathFromState(state, linking.config).startsWith('/inventory?'));
  }
  assert.equal(decoderCalls, 0);
  // Positive control: the stock React Navigation fallback really hits the
  // tripwire. A broken hook or blanket query-string mock cannot pass this test.
  const fallback = require(path.join(router, 'build/react-navigation/core/getStateFromPath.js'));
  assert.throws(() => fallback.getStateFromPath('/inventory?value=%41', config), /VULNERABLE_DECODER_REACHED/);
  assert.ok(decoderCalls > 0);
  console.log(JSON.stringify({ cases, activeDecoderCalls: 0, fallbackDecoderCalls: decoderCalls }));
`;

describe('installed dependency advisory boundaries', () => {
  it('keeps malformed and ordinary direct-link queries away from the dormant decoder', () => {
    const result = spawnSync(process.execPath, ['--input-type=commonjs', '-e', routingProbe, root], {
      cwd: root, encoding: 'utf8', timeout: 10_000, windowsHide: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ cases: 60, activeDecoderCalls: 0 });
    expect(JSON.parse(result.stdout).fallbackDecoderCalls).toBeGreaterThan(0);
  });

  it('uses the patched ESLint Zod API and bounds oversized constrained collections', () => {
    const require = createRequire(import.meta.url);
    const hooksRequire = createRequire(require.resolve('eslint-plugin-react-hooks'));
    const { z } = hooksRequire('zod/v4');
    const { fromZodError } = hooksRequire('zod-validation-error/v4');
    const schemas = [
      [z.array(z.string()).max(1), ['ok'], Array(10_000).fill(0)],
      [z.set(z.string()).max(1), new Set(['ok']), new Set(Array.from({ length: 10_000 }, (_, n) => n))],
    ];
    for (const [schema, valid, oversized] of schemas) {
      assert.deepEqual(schema.parse(valid), valid);
      const result = schema.safeParse(oversized);
      expect(result.success).toBe(false);
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].code).toBe('too_big');
      expect(fromZodError(result.error).message).toContain('1');
    }
  });
});
