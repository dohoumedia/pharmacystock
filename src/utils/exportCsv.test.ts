import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportCsv } from './exportCsv';
const mocks = vi.hoisted(() => ({ create: vi.fn(), write: vi.fn(), remove: vi.fn(), share: vi.fn(), available: vi.fn() }));
vi.mock('expo-file-system', () => ({ Paths: { cache: 'file:///cache/' }, File: class { uri: string; constructor(root: string, name: string) { this.uri = root + name; } create = mocks.create; write = mocks.write; delete = mocks.remove; } }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: mocks.available, shareAsync: mocks.share }));
beforeEach(() => { vi.clearAllMocks(); mocks.available.mockResolvedValue(true); mocks.share.mockResolvedValue(undefined); });
describe('native CSV file export', () => {
  it('writes UTF-8 content and shares an actual named file URI', async () => { await exportCsv('sales-Main.csv', '\uFEFF"Médicament"\r\n'); expect(mocks.write).toHaveBeenCalledWith('\uFEFF"Médicament"\r\n'); expect(mocks.share).toHaveBeenCalledWith('file:///cache/sales-Main.csv', expect.objectContaining({ mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' })); expect(mocks.remove).toHaveBeenCalledOnce(); });
  it('cleans up a cancelled or failed share without claiming delivery', async () => { mocks.share.mockRejectedValue(new Error('cancelled')); await expect(exportCsv('a.csv', 'data')).rejects.toThrow('cancelled'); expect(mocks.remove).toHaveBeenCalledOnce(); });
  it('reports unavailable sharing before creating a temporary file', async () => { mocks.available.mockResolvedValue(false); await expect(exportCsv('a.csv', 'data')).rejects.toThrow('REPORT_SHARING_UNAVAILABLE'); expect(mocks.create).not.toHaveBeenCalled(); });
});
