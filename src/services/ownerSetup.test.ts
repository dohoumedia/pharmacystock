import { beforeEach, describe, expect, it, vi } from 'vitest';
import { acceptInvitation, createPharmacy, inviteStaff, loadIncomingInvitations, loadSetupProgress, setupErrorKey } from './ownerSetup';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
beforeEach(() => { vi.clearAllMocks(); });
describe('owner setup service', () => {
  it('creates the pharmacy and first branch in one server operation and normalizes conventions', async () => {
    mocks.rpc.mockResolvedValue({ data: { organization_id: 'pharmacy', branch_id: 'main' }, error: null });
    await expect(createPharmacy({ name: ' Pharmacy ', branchName: ' Main ', country: ' bj ', currency: ' xof ', timezone: 'UTC', locale: 'fr' })).resolves.toEqual({ organizationId: 'pharmacy', branchId: 'main' });
    expect(mocks.rpc).toHaveBeenCalledWith('complete_owner_setup', { p_name: 'Pharmacy', p_branch_name: 'Main', p_country_code: 'BJ', p_currency_code: 'XOF', p_timezone: 'UTC', p_locale: 'fr' });
  });
  it('does not submit invalid pharmacy data', async () => {
    await expect(createPharmacy({ name: '', branchName: 'Main', country: '', currency: 'XOF', timezone: 'UTC', locale: 'en' })).rejects.toThrow('setup.errors.names');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('preserves a backend failure so the form can show a localized retry state', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'network timeout' } });
    await expect(createPharmacy({ name: 'Pharmacy', branchName: 'Main', country: '', currency: 'CAD', timezone: 'UTC', locale: 'en' })).rejects.toEqual({ message: 'network timeout' });
    expect(setupErrorKey({ message: 'network timeout' })).toBe('production.error.temporary');
  });
  it('normalizes the invite email and preserves the chosen role and branch', async () => {
    mocks.rpc.mockResolvedValue({ data: 'invitation', error: null });
    await inviteStaff('org', { name: ' Marie ', email: ' MARIE@example.test ', roleId: 'cashier', branchId: 'main' });
    expect(mocks.rpc).toHaveBeenCalledWith('invite_staff', { p_organization_id: 'org', p_email: 'marie@example.test', p_display_name: 'Marie', p_role_id: 'cashier', p_branch_id: 'main' });
  });
  it('rejects an invalid invitation before calling the backend', async () => {
    await expect(inviteStaff('org', { name: 'Marie', email: 'bad', roleId: 'cashier', branchId: 'main' })).rejects.toThrow('setup.errors.email');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('loads the verified-email inbox without trusting a client-supplied email', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await loadIncomingInvitations();
    expect(mocks.rpc).toHaveBeenCalledWith('my_staff_invitations');
  });
  it('accepts into the returned organization for provider refresh', async () => {
    mocks.rpc.mockResolvedValue({ data: 'org', error: null });
    await expect(acceptInvitation('invite')).resolves.toBe('org');
    expect(mocks.rpc).toHaveBeenCalledWith('accept_staff_invitation', { p_invitation_id: 'invite' });
  });
  it.each(['EMAIL_VERIFICATION_REQUIRED', 'INVITATION_UNAVAILABLE', 'INVITATION_PENDING', 'INVITATION_ALREADY_MEMBER'])('localizes actionable invitation errors (%s)', (message) => {
    expect(setupErrorKey({ message })).toMatch(/^setup.errors\./);
  });
  it('reads checklist facts from the server, scoped to the selected branch', async () => {
    mocks.rpc.mockResolvedValue({ data: { pharmacy: true, branch: true, staff: true, supplier: false, product: true, purchase: false }, error: null });
    expect(await loadSetupProgress('org', 'main')).toEqual({ pharmacy: true, branch: true, staff: true, supplier: false, product: true, purchase: false });
    expect(mocks.rpc).toHaveBeenCalledWith('owner_setup_progress', { p_organization_id: 'org', p_branch_id: 'main' });
  });
});
