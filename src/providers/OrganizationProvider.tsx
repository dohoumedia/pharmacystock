import type { PropsWithChildren } from 'react';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useAuth } from './AuthProvider';
import { useConnectivity } from './ConnectivityProvider';
import { LocalStore } from '@/offline/localStore';
import { errorPresentationKey } from '@/utils/errorPresentation';
import { selectedActiveBranch } from '@/domain/ownerSetup';
import { assignedBranches } from '@/domain/staffAccess';
import {
  cacheOrganizationContext,
  cacheOrganizations,
  getCachedOrganizationContext,
  getCachedOrganizations,
} from '@/offline/readModels';
import {
  loadOrganizationContext,
  loadOrganizationsForUser,
  loadMembershipUnavailable,
  type Branch,
  type Membership,
  type Organization,
  type Role,
} from '@/services/organization';

import { OrganizationContext, type OrganizationContextValue } from './organizationContext';
const localStore = new LocalStore();

export function OrganizationProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const { isOnline } = useConnectivity();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationIdState] = useState<string | null>(null);
  const [branchId, setBranchIdState] = useState<string | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [configurationBranches, setConfigurationBranches] = useState<Branch[]>([]);
  const [managementBranches, setManagementBranches] = useState<Branch[]>([]);
  const [accessUnavailable, setAccessUnavailable] = useState(false);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingCachedData, setUsingCachedData] = useState(false);
  const [contextSyncedAt, setContextSyncedAt] = useState<string | null>(null);

  const applyContext = useCallback((context: { branches: Branch[]; membership: Membership | null; role: Role | null; permissions: string[]; branchIds?: string[] }, syncedAt: string | null, cached: boolean) => {
    const permitted = assignedBranches(context.branches, context.membership, context.branchIds, context.permissions);
    setBranches(permitted);
    setManagementBranches(context.branches.filter(item => item.status === 'active'));
    setConfigurationBranches(context.branches);
    setMembership(context.membership);
    setRole(context.role);
    setPermissions(context.permissions);
    setContextSyncedAt(syncedAt);
    setUsingCachedData(cached);
    setBranchIdState((current) => selectedActiveBranch(permitted, current ?? (user ? localStore.get<string>(`selectedBranch:${user.id}:${context.membership?.organization_id}`)?.data ?? null : null)));
  }, [user]);

  const generation = useRef(0);
  const activeRequest = useRef<number | null>(null);
  const refresh = useCallback(async (preferredOrganizationId?: string, background = false) => {
    if (background && activeRequest.current !== null) return false;
    const token = ++generation.current;
    activeRequest.current = token;
    const current = () => token === generation.current;
    if (!user) {
      setOrganizations([]);
      setOrganizationIdState(null);
      setBranchIdState(null);
      setBranches([]);
      setManagementBranches([]);
      setConfigurationBranches([]);
      setAccessUnavailable(false);
      setMembership(null);
      setRole(null);
      setPermissions([]);
      setUsingCachedData(false);
      setContextSyncedAt(null);
      setLoading(false);
      activeRequest.current = null;
      return false;
    }

    if (!background) setLoading(true);
    setError(null);
    try {
      const cachedOrganizations = getCachedOrganizations(localStore, user.id);
      const nextOrganizations = isOnline
        ? await loadOrganizationsForUser(user.id)
        : cachedOrganizations?.data ?? [];
      if (!current()) return false;

      if (isOnline) cacheOrganizations(localStore, user.id, nextOrganizations);
      setOrganizations(nextOrganizations);

      const requestedOrganizationId = preferredOrganizationId ?? organizationId;
      const selectedOrganizationId =
        requestedOrganizationId && nextOrganizations.some((item) => item.id === requestedOrganizationId)
          ? requestedOrganizationId
          : nextOrganizations[0]?.id ?? null;
      setOrganizationIdState(selectedOrganizationId);

      if (!selectedOrganizationId) {
        setBranches([]);
        setManagementBranches([]);
        setConfigurationBranches([]);
        setBranchIdState(null);
        setMembership(null);
        setRole(null);
        setPermissions([]);
        setContextSyncedAt(cachedOrganizations?.syncedAt ?? null);
        setUsingCachedData(!isOnline);
        if (isOnline) {
          const unavailable = await loadMembershipUnavailable();
          if (!current()) return false;
          setAccessUnavailable(unavailable);
        }
        if (!isOnline) setError(errorPresentationKey('OFFLINE_CACHE_EMPTY'));
        return isOnline;
      }

      setAccessUnavailable(false);

      const cachedContext = getCachedOrganizationContext(localStore, user.id, selectedOrganizationId);
      if (!isOnline) {
        if (!cachedContext) {
          setError(errorPresentationKey('OFFLINE_CACHE_EMPTY'));
          applyContext({ branches: [], membership: null, role: null, permissions: [] }, cachedOrganizations?.syncedAt ?? null, true);
          return false;
        }
        applyContext(cachedContext.data, cachedContext.syncedAt, true);
        return false;
      }

      const context = await loadOrganizationContext(selectedOrganizationId, user.id);
      if (!current()) return false;
      const syncedAt = new Date().toISOString();
      cacheOrganizationContext(localStore, user.id, selectedOrganizationId, context, syncedAt);
      applyContext(context, syncedAt, false);
      return true;
    } catch (cause) {
      if (!current()) return false;
      const fallbackOrganizations = getCachedOrganizations(localStore, user.id);
      const selectedOrganizationId = organizationId ?? fallbackOrganizations?.data[0]?.id ?? null;
      const fallbackContext = selectedOrganizationId
        ? getCachedOrganizationContext(localStore, user.id, selectedOrganizationId)
        : null;

      if (fallbackOrganizations) setOrganizations(fallbackOrganizations.data);
      if (selectedOrganizationId) setOrganizationIdState(selectedOrganizationId);
      if (fallbackContext) applyContext(fallbackContext.data, fallbackContext.syncedAt, true);
      setError(errorPresentationKey(cause));
      return false;
    } finally {
      if (current()) setLoading(false);
      if (activeRequest.current === token) activeRequest.current = null;
    }
  }, [applyContext, isOnline, organizationId, user]);

  const invalidateContext = useCallback(() => { generation.current++; activeRequest.current = null; }, []);
  useEffect(() => { invalidateContext(); return invalidateContext; }, [user?.id, invalidateContext]);

  // Foreground and bounded polling keep an already signed-in colleague's role
  // and branch context current, without clearing branch-bound forms on each tick.
  useEffect(() => {
    if (!user || !isOnline) return;
    const update = () => { void refresh(undefined, true); };
    const timer = setInterval(update, 30000);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') update(); });
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.addEventListener('focus', update);
    return () => { clearInterval(timer); subscription.remove(); if (Platform.OS === 'web' && typeof window !== 'undefined') window.removeEventListener('focus', update); };
  }, [refresh, user, isOnline]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void refresh();
    }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const setOrganizationId = useCallback((id: string) => {
    invalidateContext();
    setOrganizationIdState(id);
    setBranchIdState(null);
  }, [invalidateContext]);

  const setBranchId = useCallback((id: string | null) => {
    const selected = selectedActiveBranch(branches, id);
    setBranchIdState(selected);
    if (user && organizationId && selected) localStore.set(`selectedBranch:${user.id}:${organizationId}`, { data: selected, syncedAt: new Date().toISOString() });
  }, [branches, user, organizationId]);

  const value = useMemo<OrganizationContextValue>(() => ({
    organizations,
    organization: organizations.find((item) => item.id === organizationId) ?? null,
    branches,
    managementBranches,
    configurationBranches,
    accessUnavailable,
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
  }), [organizations, organizationId, branches, managementBranches, configurationBranches, accessUnavailable, branchId, membership, role, permissions, loading, error, usingCachedData, contextSyncedAt, refresh, setOrganizationId, setBranchId]);

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

export function useOrganization() {
  const value = useContext(OrganizationContext);
  if (!value) throw new Error('useOrganization must be used inside OrganizationProvider');
  return value;
}
