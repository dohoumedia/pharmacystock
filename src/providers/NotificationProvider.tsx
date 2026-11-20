import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import { usePathname } from 'expo-router';
import { LocalStore } from '../offline/localStore';
import { useAuth } from './AuthProvider';
import { useOrganization } from './OrganizationProvider';
import { useConnectivity } from './ConnectivityProvider';
import { hasFreshMutationAuthorization } from '../domain/mutationAuthorization';
import { NOTIFICATION_REFRESH_MS, notificationVisible, type OperationalNotification } from '../domain/notificationFollowup';
import { markAllNotificationsRead, notificationList, notificationUnreadCount, refreshNotificationConditions, setNotificationRead } from '../services/notifications';
import { loadNotificationPreferences } from '../services/coreCompletion';
import { observeSettings } from '../services/settingsEvents';
type InboxSnapshot = { items: OperationalNotification[]; count: number; hasMore: boolean; enabled: boolean };
type Inbox = InboxSnapshot & { unread: boolean; loading: boolean; busy: boolean; cached: boolean; syncedAt: string | null; error: boolean; writable: boolean; setUnread: (value: boolean) => void; refresh: () => Promise<void>; more: () => Promise<void>; read: (id: string, value: boolean) => Promise<boolean>; readAll: () => Promise<void> };
const empty = { items: [], count: 0, hasMore: false, enabled: true };
const Context = createContext<Inbox>({ ...empty, unread: false, loading: false, busy: false, cached: false, syncedAt: null, error: false, writable: false, setUnread: () => {}, refresh: async () => {}, more: async () => {}, read: async () => false, readAll: async () => {} });
export const useNotifications = () => useContext(Context);
export function NotificationProvider({ children }: PropsWithChildren) {
  const { user } = useAuth(); const { organization } = useOrganization();
  return <ScopedInbox userId={user?.id} organizationId={organization?.id}>{children}</ScopedInbox>;
}
function ScopedInbox({ children, userId, organizationId }: PropsWithChildren<{ userId?: string; organizationId?: string }>) {
  const { isOnline } = useConnectivity();
  const { branches, permissions, can, usingCachedData, contextSyncedAt } = useOrganization();
  const allowed = can('notification.read');
  const pathname = usePathname();
  const local = useMemo(() => new LocalStore(), []);
  const [state, setState] = useState<InboxSnapshot & { scopeKey?: string }>(empty);
  const [unread, setUnread] = useState(false), [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [cached, setCached] = useState(false), [error, setError] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const flight = useRef<number | null>(null), mutation = useRef<number | null>(null), generation = useRef(0), mounted = useRef(true);
  const accessKey = `${branches.map(b => b.id).sort().join(',')}:${[...permissions].sort().join(',')}`;
  const key = `notifications:${userId}:${organizationId}:${accessKey}:${unread}`;
  const scopeMatches = state.scopeKey === key;
  const scopedState = scopeMatches ? state : empty;
  const requestContext = JSON.stringify([key, pathname, isOnline, usingCachedData, allowed]);
  const committedContext = useRef(requestContext);
  useLayoutEffect(() => {
    const epoch = generation; const alive = mounted;
    committedContext.current = requestContext; epoch.current++; alive.current = true;
    return () => { alive.current = false; epoch.current++; };
  }, [requestContext]);
  const writable = hasFreshMutationAuthorization(isOnline, usingCachedData, contextSyncedAt) && allowed;
  const fetchPage = useCallback(async (nextPage = 0) => {
    if (!mounted.current || committedContext.current !== requestContext || !userId || !organizationId || !allowed || !isOnline || usingCachedData || flight.current === generation.current) return;
    const ticket = generation.current;
    flight.current = ticket; setLoading(true); setError(false);
    try {
      await refreshNotificationConditions(organizationId);
      const [list, count, pref] = await Promise.all([notificationList(organizationId, userId, unread, nextPage), notificationUnreadCount(organizationId, userId), loadNotificationPreferences(organizationId, userId)]);
      if (!mounted.current || ticket !== generation.current) return;
      const next = { items: list.items, hasMore: list.hasMore, count, enabled: pref?.in_app ?? true };
      const stamp = new Date().toISOString();
      if (nextPage === 0) local.set(key, { data: next, syncedAt: stamp });
      setState(previous => ({ ...next, scopeKey: key, items: nextPage && previous.scopeKey === key ? [...previous.items, ...next.items.filter(n => !previous.items.some(p => p.id === n.id))] : next.items }));
      setPage(nextPage); setSyncedAt(stamp); setCached(false);
    } catch { if (ticket === generation.current) { setError(true); setCached(true); } }
    finally { if (ticket === generation.current) { flight.current = null; setLoading(false); } }
  }, [allowed, isOnline, key, local, organizationId, unread, userId, usingCachedData, requestContext, setLoading, setError, setState, setPage, setSyncedAt, setCached]);
  const refresh = useCallback(() => fetchPage(0), [fetchPage]);
  useEffect(() => {
    const ticket = generation.current; let active = true;
    const timer = setTimeout(() => {
      if (!mounted.current || ticket !== generation.current) return;
      const saved = allowed ? local.get<InboxSnapshot>(key) : null;
      setState({ ...(saved?.data ?? empty), scopeKey: key }); setSyncedAt(saved?.syncedAt ?? null); setCached(Boolean(saved)); setPage(0); setLoading(false); setBusy(false); setError(false);
      void refresh();
    }, 0);
    const interval = setInterval(() => { if (active && AppState.currentState === 'active') void refresh(); }, NOTIFICATION_REFRESH_MS);
    const subscription = AppState.addEventListener('change', value => { if (value === 'active') void refresh(); });
    const stop = observeSettings(org => { if (org === organizationId) void refresh(); });
    return () => { active = false; clearTimeout(timer); clearInterval(interval); subscription.remove(); stop(); };
  }, [allowed, key, local, organizationId, refresh, pathname]);
  const mutate = async (action: () => Promise<void>) => {
    if (!mounted.current || committedContext.current !== requestContext || !writable || mutation.current === generation.current) return false;
    const ticket = generation.current;
    const current = () => mounted.current && ticket === generation.current;
    mutation.current = ticket; setBusy(true); setError(false);
    try {
      await action();
      if (!current()) return false;
      await refresh();
      return current();
    } catch { if (current()) setError(true); return false; }
    finally { if (mutation.current === ticket) { mutation.current = null; if (current()) setBusy(false); } }
  };
  const read = async (id: string, value: boolean) => organizationId && userId
    ? mutate(() => setNotificationRead(organizationId, userId, id, value)) : false;
  const readAll = async () => { if (organizationId && userId) await mutate(() => markAllNotificationsRead(organizationId, userId)); };
  const visible = scopedState.items.filter(n => notificationVisible(n, branches, can));
  return <Context.Provider value={{ ...scopedState, items: allowed ? visible : [], count: allowed ? scopedState.count : 0, unread, loading: scopeMatches && loading, busy: scopeMatches && busy, cached: (scopeMatches && cached) || !isOnline || usingCachedData, syncedAt: scopeMatches ? syncedAt : null, error: scopeMatches && error, writable, setUnread, refresh, more: () => fetchPage(page + 1), read, readAll }}>{children}</Context.Provider>;
}
