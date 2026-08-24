import { describe, expect, it, vi } from 'vitest';
import metroConfig from '../../metro.config.js';

describe('Metro Web SQLite configuration', () => {
  it('resolves WebAssembly assets and enables cross-origin isolation headers', () => {
    expect(metroConfig.resolver.assetExts).toContain('wasm');

    const middleware = vi.fn();
    const wrapped = metroConfig.server.enhanceMiddleware(middleware, {});
    const setHeader = vi.fn();
    const next = vi.fn();

    wrapped({}, { setHeader }, next);

    expect(setHeader).toHaveBeenCalledWith(
      'Cross-Origin-Embedder-Policy',
      'credentialless',
    );
    expect(setHeader).toHaveBeenCalledWith(
      'Cross-Origin-Opener-Policy',
      'same-origin',
    );
    expect(middleware).toHaveBeenCalledWith({}, { setHeader }, next);
  });
});
