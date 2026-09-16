type ConnectivityResponse = {
  ok: boolean;
};

type ConnectivityFetch = (
  input: string,
  init: { method: 'GET'; headers: { apikey: string }; cache: 'no-store' },
) => Promise<ConnectivityResponse>;

/**
 * Checks the documented public Supabase Auth health endpoint. This intentionally
 * uses only the publishable key: it verifies service availability without
 * depending on a user's session or querying tenant data.
 */
export async function isSupabaseAvailable(
  fetchImpl: ConnectivityFetch,
  supabaseUrl: string,
  publishableKey: string,
): Promise<boolean> {
  try {
    const response = await fetchImpl(`${supabaseUrl}/auth/v1/health`, {
      method: 'GET',
      headers: { apikey: publishableKey },
      cache: 'no-store',
    });
    return response.ok;
  } catch {
    return false;
  }
}
