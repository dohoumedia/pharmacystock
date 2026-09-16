import { describe, expect, it, vi } from 'vitest';
import { isSupabaseAvailable } from './connectivityProbe';

const supabaseUrl = 'https://project-ref.supabase.co';
const publishableKey = 'public-anon-key';

describe('isSupabaseAvailable', () => {
  it('reports available only for a successful documented Auth health response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });

    await expect(isSupabaseAvailable(fetchImpl, supabaseUrl, publishableKey)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(`${supabaseUrl}/auth/v1/health`, {
      method: 'GET',
      headers: { apikey: publishableKey },
      cache: 'no-store',
    });
  });

  it('reports unavailable for a non-2xx response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 });

    await expect(isSupabaseAvailable(fetchImpl, supabaseUrl, publishableKey)).resolves.toBe(false);
  });

  it('reports unavailable when the network request fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(isSupabaseAvailable(fetchImpl, supabaseUrl, publishableKey)).resolves.toBe(false);
  });
});
