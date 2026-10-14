import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../lib/env';
import type { SalesDatabase } from '../services/sales';
import type { OutboxOperation, OutboxStore } from './outbox';
import { stableOutboxSerialize } from './outboxRecovery';
import { ReplayDispatchSkipped } from './replayDispatch';
import { offlineSessionScope, type OfflineReplayScope } from './sessionScope';

export type ReplaySaleDispatchContext = {
  outbox: OutboxStore;
  operation: OutboxOperation;
  scope: OfflineReplayScope;
  canReplay: () => boolean;
};

// Decoding is an additional owner fence, not JWT verification. The server still
// verifies the token signature and authorizes the unchanged RPC.
function tokenOwner(token: string): string | null {
  try {
    const encoded = token.split('.')[1]!.replace(/=+$/, '');
    // Native runtimes need not provide atob. Decode only the JWT payload here;
    // the ASCII subject is the only claim used by this additional local fence.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let value = 0;
    let bits = 0;
    let decoded = '';
    for (const character of encoded) {
      const digit = alphabet.indexOf(character);
      if (digit < 0) return null;
      value = (value << 6) | digit;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        decoded += String.fromCharCode((value >>> bits) & 255);
      }
    }
    const payload = JSON.parse(decoded);
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export function createReplaySaleTransport(source: SupabaseClient, context: ReplaySaleDispatchContext) {
  const expected = JSON.parse(stableOutboxSerialize(context.operation)) as OutboxOperation;
  const scope = { ...context.scope };
  let dispatched = false;
  let token: string | null = null;
  const current = () => !dispatched && context.canReplay()
    && offlineSessionScope.isReplayScopeCurrent(scope);
  let skipped: ReplayDispatchSkipped | undefined;
  const skip = (): never => {
    skipped ??= new ReplayDispatchSkipped();
    throw skipped;
  };
  const assertCurrent = () => {
    if (!current()) skip();
  };
  // SDK Realtime initialization also asks for accessToken. Both consumers share
  // one acquisition; this client has no auth storage or auth lifecycle of its own.
  let acquisition: Promise<string | null> | undefined;
  let acquisitionError: unknown;
  const accessToken = () => acquisition ??= (async () => {
    assertCurrent();
    const { data, error } = await source.auth.getSession();
    assertCurrent();
    if (error) throw error;
    if (data.session?.user.id !== scope.userId) return skip();
    token = data.session.access_token;
    if (tokenOwner(token) !== scope.userId) return skip();
    return token;
  })().catch((error: unknown) => {
    // Realtime's eager initialization must not log a cancellation or acquire
    // another token. Surface it only through the guarded RPC fetch boundary.
    acquisitionError = error;
    return null;
  });
  const networkFetch = globalThis.fetch.bind(globalThis);
  const client = createClient<SalesDatabase>(env.supabaseUrl, env.supabasePublishableKey, {
    accessToken,
    global: {
      fetch: async (input, init) => {
        // fetchWithAuth has already acquired the token and prepared headers.
        assertCurrent();
        if (acquisitionError) throw acquisitionError;
        const authorized = () => current() && token !== null && tokenOwner(token) === scope.userId
          && new Headers(init?.headers).get('Authorization') === `Bearer ${token}`;
        if (!authorized()) return skip();
        let response: Promise<Response> | undefined;
        const started = await context.outbox.dispatchIfAuthoritative(expected, scope.userId!, authorized, () => {
          if (!authorized()) return skip();
          // No await between the last fence and physical fetch invocation.
          // Once invoked, this request is outside local cancellation guarantees.
          dispatched = true;
          response = networkFetch(input, init);
          // Handle an early rejection while the short IDB transaction completes.
          void response.catch(() => undefined);
        });
        if (!started || !response) return skip();
        return response;
      },
    },
  });
  return {
    client,
    // Postgrest normally converts fetch errors to response objects. Restore only
    // our local typed skip; retain the existing server/network error semantics.
    throwIfSkipped: () => { if (skipped) throw skipped; },
  };
}
