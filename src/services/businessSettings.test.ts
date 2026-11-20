import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveBusinessProfile, saveBranchConfiguration } from './businessSettings';
import { saveOrganizationSettings, saveNotificationPreferences } from './coreCompletion';
const f = vi.hoisted(() => ({ from:vi.fn(), update:vi.fn(), eq:vi.fn(), select:vi.fn(), single:vi.fn(), upsert:vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { from:f.from } }));
vi.mock('@/lib/supabase', () => ({ supabase: { from:f.from } }));
beforeEach(() => { vi.clearAllMocks(); const builder={ update:f.update,eq:f.eq,select:f.select,single:f.single,upsert:f.upsert }; for (const method of [f.from,f.update,f.eq,f.select,f.upsert]) method.mockReturnValue(builder); f.single.mockResolvedValue({data:{id:'saved'},error:null}); });
describe('existing settings records and retry behavior', () => {
  it('normalizes the existing organization profile and returns the saved row', async () => {
    await expect(saveBusinessProfile('org',{name:' Pharmacy ',timezone:'UTC',currency_code:'cad',country_code:'ca'})).resolves.toEqual({id:'saved'});
    expect(f.from).toHaveBeenCalledWith('organizations'); expect(f.update).toHaveBeenCalledWith({name:'Pharmacy',timezone:'UTC',currency_code:'CAD',country_code:'CA'}); expect(f.eq).toHaveBeenCalledWith('id','org');
  });
  it('validates branch settings, preserves nullable inheritance, and scopes the update', async () => {
    await saveBranchConfiguration('org','branch',{name:' Main ',timezone:'',address_line1:'Street',address_line2:null,city:null,phone:null,email:'qa@example.test',status:'active'});
    expect(f.eq).toHaveBeenCalledWith('organization_id','org'); expect(f.eq).toHaveBeenCalledWith('id','branch'); expect(f.update.mock.calls[0]![0]).toMatchObject({name:'Main',timezone:null});
    await expect(saveBranchConfiguration('org','branch',{name:'',timezone:null} as never)).rejects.toThrow('NAME');
  });
  it('recovers a failed save by retrying the exact same single organization settings record', async () => {
    const draft={organization_id:'org',receipt_footer:'Merci',default_payment_method:'CARD' as const,low_stock_default_threshold:2.5};
    f.single.mockResolvedValueOnce({data:null,error:{message:'response lost'}});
    await expect(saveOrganizationSettings(draft)).rejects.toEqual({message:'response lost'}); await saveOrganizationSettings(draft);
    expect(f.upsert.mock.calls).toEqual([[draft,{onConflict:'organization_id'}],[draft,{onConflict:'organization_id'}]]);
  });
  it('updates one user preference without enabling unimplemented channels', async () => {
    const draft={organization_id:'org',user_id:'user',in_app:false,email:false,sms:false,whatsapp:false,push:false}; await saveNotificationPreferences(draft);
    expect(f.from).toHaveBeenCalledWith('notification_preferences'); expect(f.upsert).toHaveBeenCalledWith(draft,{onConflict:'organization_id,user_id'});
  });
  it('propagates a business-save rejection so the form can retain values and show retry', async () => {
    f.single.mockResolvedValue({data:null,error:{message:'SETTINGS_CURRENCY_LOCKED'}}); await expect(saveBusinessProfile('org',{name:'Pharmacy',timezone:'UTC',currency_code:'EUR',country_code:null})).rejects.toMatchObject({message:'SETTINGS_CURRENCY_LOCKED'});
  });
});
