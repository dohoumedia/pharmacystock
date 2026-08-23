import type { PropsWithChildren } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthProvider';
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
  setOrganizationId: (id: string) => void;
  setBranchId: (id: string | null) => void;
  refresh: () => Promise<void>;
  can: (permission: string) => boolean;
};

const OrganizationContext = createContext<OrganizationContextValue | undefined>(undefined);

export function OrganizationProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationIdState] = useState<string | null>(null);
  const [branchId, setBranchIdState] = useState<string | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setOrganizations([]);
      setOrganizationIdState(null);
      setBranchIdState(null);
      setBranches([]);
      setMembership(null);
      setRole(null);
      setPermissions([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const nextOrganizations = await loadOrganizationsForUser(user.id);
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
        return;
      }

      const context = await loadOrganizationContext(selectedOrganizationId, user.id);
      setBranches(context.branches);
      setMembership(context.membership);
      setRole(context.role);
      setPermissions(context.permissions);
      setBranchIdState((current) => {
        if (current && context.branches.some((item) => item.id === current)) return current;
        return context.branches[0]?.id ?? null;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR');
    } finally {
      setLoading(false);
    }
  }, [organizationId, user]);

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
    setOrganizationId,
    setBranchId,
    refresh,
    can: (permission) => permissions.includes(permission),
  }), [organizations, organizationId, branches, branchId, membership, role, permissions, loading, error, refresh]);

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

export function useOrganization() {
  const value = useContext(OrganizationContext);
  if (!value) throw new Error('useOrganization must be used inside OrganizationProvider');
  return value;
}
