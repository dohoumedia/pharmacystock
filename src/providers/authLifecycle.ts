import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

type SessionResult = { data: { session: Session | null }; error: unknown };

export type AuthLifecycleClient = {
  getSession: () => Promise<SessionResult>;
  onAuthStateChange: (
    callback: (event: AuthChangeEvent, session: Session | null) => void,
  ) => { data: { subscription: { unsubscribe: () => void } } };
};

type AuthLifecycleCallbacks = {
  commit: (session: Session | null, loading: boolean) => void;
  bindUser: (userId: string | null) => void;
};

export type AuthLifecycle = {
  acceptSession: (session: Session) => void;
  acceptSignedOut: () => void;
  stop: () => void;
};

const DEFAULT_RESTORATION_TIMEOUT_MS = 2_000;

/**
 * Bridges Supabase's persisted session into application state.
 *
 * A null INITIAL_SESSION callback can represent a failed/transient restoration.
 * It is paired with getSession() before unauthenticated state is committed.
 * Only SIGNED_OUT is an unconditional runtime account boundary.
 */
export function startAuthLifecycle(
  auth: AuthLifecycleClient,
  callbacks: AuthLifecycleCallbacks,
  restorationTimeoutMs = DEFAULT_RESTORATION_TIMEOUT_MS,
): AuthLifecycle {
  let stopped = false;
  let authoritativeEventSeen = false;
  let restorationTimer: ReturnType<typeof setTimeout> | null = null;

  const clearRestorationTimer = () => {
    if (restorationTimer === null) return;
    clearTimeout(restorationTimer);
    restorationTimer = null;
  };

  // Rendering the signed-out UI is not itself an account boundary. In
  // particular, a transient INITIAL_SESSION null/error must not erase the
  // previous user's offline scope or pending intents.
  const settleUnauthenticated = () => {
    if (stopped || authoritativeEventSeen) return;
    callbacks.commit(null, false);
  };

  const acceptSession = (session: Session) => {
    if (stopped) return;
    authoritativeEventSeen = true;
    clearRestorationTimer();
    callbacks.bindUser(session.user.id);
    callbacks.commit(session, false);
  };

  const acceptSignedOut = () => {
    if (stopped) return;
    authoritativeEventSeen = true;
    clearRestorationTimer();
    callbacks.bindUser(null);
    callbacks.commit(null, false);
  };

  const { data: listener } = auth.onAuthStateChange((event, nextSession) => {
    if (event === 'SIGNED_OUT') {
      acceptSignedOut();
      return;
    }

    if (nextSession) acceptSession(nextSession);
    // Null initialization/refresh callbacks are not logout. getSession below
    // settles a genuinely unauthenticated startup.
  });

  // Supabase normally settles getSession promptly, but storage/refresh errors
  // must not leave the application shell loading forever. This fallback only
  // exposes the sign-in UI; it deliberately does not perform sign-out cleanup.
  restorationTimer = setTimeout(settleUnauthenticated, restorationTimeoutMs);

  void auth.getSession().then(({ data, error }) => {
    if (stopped || authoritativeEventSeen) return;
    if (data.session) acceptSession(data.session);
    else if (!error) {
      clearRestorationTimer();
      settleUnauthenticated();
    }
  }).catch(() => {
    // The bounded fallback renders sign-in without clearing account data. A
    // later auth event can still establish a restored/refreshed session.
  });

  return {
    acceptSession,
    acceptSignedOut,
    stop: () => {
      stopped = true;
      clearRestorationTimer();
      listener.subscription.unsubscribe();
    },
  };
}
