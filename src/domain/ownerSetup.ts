export type SetupStep = 'pharmacy' | 'branch' | 'staff' | 'supplier' | 'product' | 'purchase';

export function firstUseState(input: { loading: boolean; error: string | null; online: boolean; hasOrganization: boolean; hasBranch: boolean; canManageBranches: boolean; cached: boolean }) {
  if (input.loading && (!input.hasOrganization || !input.hasBranch)) return 'loading';
  if (input.error && (!input.hasOrganization || !input.hasBranch)) return 'error';
  if (!input.online && !input.hasOrganization) return 'offline';
  if (!input.hasOrganization && !input.cached) return 'pharmacy';
  if (input.hasOrganization && !input.hasBranch && input.canManageBranches) return 'branch';
  return 'ready';
}

/** A stable request identity for branch form retries; never used as a credential. */
export function newBranchId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === 'x' ? random : (random & 3) | 8).toString(16);
  });
}

export function setupSteps(progress: Record<SetupStep, boolean>) {
  return (['pharmacy', 'branch', 'staff', 'supplier', 'product', 'purchase'] as const).map((id) => ({ id, complete: progress[id] }));
}

export function validatePharmacy(input: { name: string; branchName: string; country: string; currency: string; timezone: string }) {
  if (!input.name.trim() || !input.branchName.trim()) return 'setup.errors.names';
  if (input.name.trim().length > 160 || input.branchName.trim().length > 160) return 'setup.errors.names';
  if (input.country.trim() && !/^[A-Z]{2}$/.test(input.country.trim().toUpperCase())) return 'setup.errors.country';
  if (!/^[A-Z]{3}$/.test(input.currency.trim().toUpperCase())) return 'setup.errors.currency';
  try { new Intl.DateTimeFormat('en', { timeZone: input.timezone.trim() }).format(); } catch { return 'setup.errors.timezone'; }
  return null;
}

export function validateInvitation(input: { email: string; name: string; roleId: string; branchId: string }) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()) || input.email.trim().length > 254) return 'setup.errors.email';
  if (!input.name.trim() || input.name.trim().length > 160) return 'setup.errors.staffName';
  if (!input.roleId || !input.branchId) return 'setup.errors.assignment';
  return null;
}

export function selectedActiveBranch<T extends { id: string; status: string }>(branches: T[], selected: string | null) {
  const active = branches.filter((item) => item.status === 'active');
  return active.find((item) => item.id === selected)?.id ?? active[0]?.id ?? null;
}
