import { readFileSync, statSync } from 'node:fs';
import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

const publicAsset = (path) => new URL(`../public${path}`, import.meta.url);

describe('PWA installability assets', () => {
  it('declares usable PNG and maskable icons in the manifest', () => {
    const manifest = JSON.parse(readFileSync(publicAsset('/manifest.webmanifest'), 'utf8'));

    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.theme_color).toMatch(/^#[0-9A-F]{6}$/i);
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          src: '/icons/pharmacy-stock-192.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any',
        }),
        expect.objectContaining({
          src: '/icons/pharmacy-stock-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any',
        }),
        expect.objectContaining({
          src: '/icons/pharmacy-stock-maskable-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        }),
      ]),
    );
  });

  it.each([
    ['/icons/pharmacy-stock-180.png', 180],
    ['/icons/pharmacy-stock-192.png', 192],
    ['/icons/pharmacy-stock-512.png', 512],
    ['/icons/pharmacy-stock-maskable-512.png', 512],
  ])('ships a square PNG asset for %s', (path, size) => {
    const image = readFileSync(publicAsset(path));
    const expectedSize = Buffer.alloc(4);
    expectedSize.writeUInt32BE(size);

    expect(image.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(image.subarray(16, 20)).toEqual(expectedSize);
    expect(image.subarray(20, 24)).toEqual(expectedSize);
    expect(statSync(publicAsset(path)).size).toBeGreaterThan(100);
  });

  it('pre-caches all manifest icons for the offline app shell', () => {
    const serviceWorker = readFileSync(publicAsset('/sw.js'), 'utf8');

    expect(serviceWorker).toContain("'/icons/pharmacy-stock-192.png'");
    expect(serviceWorker).toContain("'/icons/pharmacy-stock-512.png'");
    expect(serviceWorker).toContain("'/icons/pharmacy-stock-maskable-512.png'");
    expect(serviceWorker).toContain("'/icons/pharmacy-stock-180.png'");
  });
});
