import type { PropsWithChildren } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthProvider';
import { useConnectivity } from './ConnectivityProvider';
import { LocalStore } from '@/offline/localStore';
import {
  cacheOrganizationContext,
  cacheOrganizations,
  getCachedOrganizationContext,
  getCachedOrganizations,
} from '@/offline/readModels';
import {
  loadOrganizationContext,
  loadOrganizationsForUser,
  type Branch,
  type Membership,
  type Organization,
  type Role,
} from '@/services/organization';

type OrganizationContextValue = {
  organizations: Organization[];
  organization: Organization | null;
  branches: Branch[];
  branch: Branch | null;
  membership: Membership | null;
  role: Role | null;
  permissions: string[];
  loading: boolean;
  error: string | null;
  usingCachedData: boolean;
  contextSyncedAt: string | null;
  setOrganizationId: (id: string) => void;
  setBranchId: (id: string | null) => void;
  refresh: () => Promise<void>;
  can: (permission: string) => boolean;
};

const OrganizationContext = createContext<OrganizationContextValue | undefined>(undefined);
const localStore = new LocalStore();

export function OrganizationProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const { isOnline } = useConnectivity();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationIdState] = useState<string | null>(null);
  const [branchId, setBranchIdState] = useState<string | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usingCachedData, setUsingCachedData] = useState(false);
  const [contextSyncedAt, setContextSyncedAt] = useState<string | null>(null);

  const applyContext = useCallback((context: { branches: Branch[]; membership: Membership | null; role: Role | null; permissions: string[] }, syncedAt: string | null, cached: boolean) => {
    setBranches(context.branches);
    setMembership(context.membership);
    setRole(context.role);
    setPermissions(context.permissions);
    setContextSyncedAt(syncedAt);
    setUsingCachedData(cached);
    setBranchIdState((current) => {
      if (current && context.branches.some((item) => item.id === current)) return current;
      return context.branches[0]?.id ?? null;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!user) {
      setOrganizations([]);
      setOrganizationIdState(null);
      setBranchIdState(null);
      setBranches([]);
      setMembership(null);
      setRole(null);
      setPermissions([]);
      setUsingCachedData(false);
      setContextSyncedAt(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const cachedOrganizations = getCachedOrganizations(localStore, user.id);
      const nextOrganizations = isOnline
        ? await loadOrganizationsForUser(user.id)
        : cachedOrganizations?.data ?? [];

      if (isOnline) cacheOrganizations(localStore, user.id, nextOrganizations);
      setOrganizations(nextOrganizations);

      const selectedOrganizationId =
        organizationId && nextOrganizations.some((item) => item.id === organizationId)
          ? organizationId
          : nextOrganizations[0]?.id ?? null;
      setOrganizationIdState(selectedOrganizationId);

      if (!selectedOrganizationId) {
        setBranches([]);
        setMembership(null);
        setRole(null);
        setPermissions([]);
        setContextSyncedAt(cachedOrganizations?.syncedAt ?? null);
        setUsingCachedData(!isOnline);
        if (!isOnline) setError('OFFLINE_CACHE_EMPTY');
        return;
      }

      const cachedContext = getCachedOrganizationContext(localStore, user.id, selectedOrganizationId);
      if (!isOnline) {
        if (!cachedContext) {
          setError('OFFLINE_CACHE_EMPTY');
          applyContext({ branches: [], membership: null, role: null, permissions: [] }, cachedOrganizations?.syncedAt ?? null, true);
          return;
        }
        applyContext(cachedContext.data, cachedContext.syncedAt, true);
        return;
      }

      const context = await loadOrganizationContext(selectedOrganizationId, user.id);
      const syncedAt = new Date().toISOString();
      cacheOrganizationContext(localStore, user.id, selectedOrganizationId, context, syncedAt);
      applyContext(context, syncedAt, false);
    } catch (cause) {
      const fallbackOrganizations = getCachedOrganizations(localStore, user.id);
      const selectedOrganizationId = organizationId ?? fallbackOrganizations?.data[0]?.id ?? null;
      const fallbackContext = selectedOrganizationId
        ? getCachedOrganizationContext(localStore, user.id, selectedOrganizationId)
        : null;

      if (fallbackOrganizations) setOrganizations(fallbackOrganizations.data);
      if (selectedOrganizationId) setOrganizationIdState(selectedOrganizationId);
      if (fallbackContext) applyContext(fallbackContext.data, fallbackContext.syncedAt, true);
      setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR');
    } finally {
      setLoading(false);
    }
  }, [applyContext, isOnline, organizationId, user]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void refresh();
    }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const setOrganizationId = (id: string) => {
    setOrganizationIdState(id);
    setBranchIdState(null);
  };

  const setBranchId = (id: string | null) => setBranchIdState(id);

  const value = useMemo<OrganizationContextValue>(() => ({
    organizations,
    organization: organizations.find((item) => item.id === organizationId) ?? null,
    branches,
    branch: branches.find((item) => item.id === branchId) ?? null,
    membership,
    role,
    permissions,
    loading,
    error,
    usingCachedData,
    contextSyncedAt,
    setOrganizationId,
    setBranchId,
    refresh,
    can: (permission) => permissions.includes(permission),
  }), [organizations, organizationId, branches, branchId, membership, role, permissions, loading, error, usingCachedData, contextSyncedAt, refresh]);

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

export function useOrganization() {
  const value = useContext(OrganizationContext);
  if (!value) throw new Error('useOrganization must be used inside OrganizationProvider');
  return value;
}
