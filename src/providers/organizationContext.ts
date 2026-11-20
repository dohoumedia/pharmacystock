import { createContext } from 'react';
import type { Branch, Membership, Organization, Role } from '../services/organization';
export type OrganizationContextValue = {
  organizations: Organization[];
  organization: Organization | null;
  branches: Branch[];
  managementBranches: Branch[];
  configurationBranches: Branch[];
  accessUnavailable: boolean;
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
  refresh: (preferredOrganizationId?: string) => Promise<boolean>;
  can: (permission: string) => boolean;
};

export const OrganizationContext = createContext<OrganizationContextValue | undefined>(undefined);
