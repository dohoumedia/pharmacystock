import type { PropsWithChildren } from 'react';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { offlineSessionScope } from '@/offline/sessionScope';
import { startAuthLifecycle, type AuthLifecycle } from './authLifecycle';

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const lifecycleRef = useRef<AuthLifecycle | null>(null);

  useEffect(() => {
    const lifecycle = startAuthLifecycle(supabase.auth, {
      bindUser: (userId) => offlineSessionScope.bindUser(userId),
      commit: (nextSession, nextLoading) => {
        setSession(nextSession);
        setLoading(nextLoading);
      },
    });
    lifecycleRef.current = lifecycle;

    return () => {
      lifecycle.stop();
      if (lifecycleRef.current === lifecycle) lifecycleRef.current = null;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      signIn: async (email, password) => {
        const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        if (data.session) lifecycleRef.current?.acceptSession(data.session);
      },
      signOut: async () => {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        lifecycleRef.current?.acceptSignedOut();
      },
    }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
