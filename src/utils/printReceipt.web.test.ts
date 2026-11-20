import { describe, expect, it, vi } from 'vitest';
import { printReceipt } from './printReceipt.web';
import type { View } from 'react-native';
describe('isolated browser receipt print document', () => {
  it('prints only the cloned receipt, retaining document language', () => {
    const appendChild = vi.fn(), remove = vi.fn(), print = vi.fn(), open = vi.fn(), write = vi.fn(), close = vi.fn();
    const receiptClone = { textContent: 'Receipt only' };
    const frame = { title: '', style: { cssText: '' }, remove, contentDocument: { open, write, close, body: { appendChild }, documentElement: { lang: '' } }, contentWindow: { addEventListener: vi.fn(), focus: vi.fn(), print } };
    vi.useFakeTimers(); vi.stubGlobal('document', { title: 'Pharmacy', documentElement: { lang: 'fr' }, createElement: () => frame, body: { appendChild: vi.fn() } });
    expect(printReceipt({ current: { cloneNode: () => receiptClone } as unknown as View })).toBe(true);
    expect(appendChild).toHaveBeenCalledWith(receiptClone); expect(print).toHaveBeenCalledOnce(); expect(frame.contentDocument.documentElement.lang).toBe('fr'); expect(write).toHaveBeenCalledWith(expect.stringContaining('@page'));
    vi.runAllTimers(); expect(remove).toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals();
  });
  it('does not print a missing receipt', () => expect(printReceipt({ current: null })).toBe(false));
});
