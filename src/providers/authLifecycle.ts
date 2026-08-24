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
): AuthLifecycle {
  let stopped = false;
  let authoritativeEventSeen = false;

  const acceptSession = (session: Session) => {
    if (stopped) return;
    authoritativeEventSeen = true;
    callbacks.bindUser(session.user.id);
    callbacks.commit(session, false);
  };

  const acceptSignedOut = () => {
    if (stopped) return;
    authoritativeEventSeen = true;
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

  void auth.getSession().then(({ data, error }) => {
    if (stopped || authoritativeEventSeen || error) return;
    if (data.session) acceptSession(data.session);
    else acceptSignedOut();
  }).catch(() => {
    // Preserve loading on transient storage/network failure. A later auth
    // event can still establish the session or report an intentional logout.
  });

  return {
    acceptSession,
    acceptSignedOut,
    stop: () => {
      stopped = true;
      listener.subscription.unsubscribe();
    },
  };
}
