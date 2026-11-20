import { describe, expect, it } from 'vitest';
import { firstUseState, newBranchId, selectedActiveBranch, setupSteps, validateInvitation, validatePharmacy } from './ownerSetup';
const initial = { loading: false, error: null, online: true, hasOrganization: false, hasBranch: false, canManageBranches: false, cached: false };
const pharmacy = { name: 'Pharmacie du Centre', branchName: 'Centre', country: 'BJ', currency: 'XOF', timezone: 'UTC' };
describe('owner first use', () => {
  it('waits for organization lookup before offering first use', () => expect(firstUseState({ ...initial, loading: true })).toBe('loading'));
  it('offers first use for a signed-in owner without an organization', () => expect(firstUseState(initial)).toBe('pharmacy'));
  it('does not mistake a failed or offline lookup for an empty membership', () => {
    expect(firstUseState({ ...initial, error: 'unavailable' })).toBe('error');
    expect(firstUseState({ ...initial, online: false })).toBe('offline');
    expect(firstUseState({ ...initial, hasOrganization: true, error: 'context failed' })).toBe('error');
  });
  it('recovers the missing first branch through setup', () => expect(firstUseState({ ...initial, hasOrganization: true, canManageBranches: true })).toBe('branch'));
  it('transitions to the normal shell once pharmacy and branch exist', () => expect(firstUseState({ ...initial, hasOrganization: true, hasBranch: true, canManageBranches: true })).toBe('ready'));
  it('keeps the main shell mounted while refreshing an existing context', () => expect(firstUseState({ ...initial, loading: true, hasOrganization: true, hasBranch: true })).toBe('ready'));
  it('validates pharmacy names, configuration and bilingual names', () => {
    expect(validatePharmacy(pharmacy)).toBeNull();
    expect(validatePharmacy({ ...pharmacy, name: ' ' })).toBe('setup.errors.names');
    expect(validatePharmacy({ ...pharmacy, timezone: 'not/a-zone' })).toBe('setup.errors.timezone');
    expect(validatePharmacy({ ...pharmacy, country: 'Benin' })).toBe('setup.errors.country');
    expect(validatePharmacy({ ...pharmacy, currency: 'FCFA' })).toBe('setup.errors.currency');
  });
  it('preserves a selected branch after refresh and falls back only to an active branch', () => {
    const branches = [{ id: 'a', status: 'active' }, { id: 'b', status: 'active' }, { id: 'c', status: 'inactive' }];
    expect(selectedActiveBranch(branches, 'b')).toBe('b');
    expect(selectedActiveBranch(branches, 'c')).toBe('a');
    expect(selectedActiveBranch([], 'b')).toBeNull();
  });
  it('creates branch request identities that can be retained across a form retry', () => {
    expect(newBranchId()).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  });
  it('progresses from saved pharmacy/branch through staff, supplier, product and PO', () => {
    const progress = { pharmacy: true, branch: true, staff: false, supplier: false, product: false, purchase: false };
    expect(setupSteps(progress).filter((step) => step.complete)).toHaveLength(2);
    progress.staff = true; progress.supplier = true; progress.product = true;
    expect(setupSteps(progress).filter((step) => !step.complete).map((step) => step.id)).toEqual(['purchase']);
    progress.purchase = true;
    expect(setupSteps(progress).every((step) => step.complete)).toBe(true);
  });
  it('requires email, staff identity, role and branch before invitation', () => {
    const draft = { email: 'colleague@example.test', name: 'Marie', roleId: 'cashier', branchId: 'centre' };
    expect(validateInvitation(draft)).toBeNull();
    expect(validateInvitation({ ...draft, email: 'wrong' })).toBe('setup.errors.email');
    expect(validateInvitation({ ...draft, name: '' })).toBe('setup.errors.staffName');
    expect(validateInvitation({ ...draft, branchId: '' })).toBe('setup.errors.assignment');
  });
});
