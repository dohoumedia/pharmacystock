import { describe, expect, it } from 'vitest';
import { notificationDestination, notificationPage, notificationVisible, type OperationalNotification } from './notificationFollowup';
const row = (type: string, payload: unknown = {}): OperationalNotification => ({ id: 'n', organization_id: 'org', branch_id: 'b1', recipient_user_id: 'u', type, title_key: '', body_key: '', payload, read_at: null, created_at: '2026-11-18T12:00Z', condition_key: 'condition', resolved_at: null, checked_at: '2026-11-18T12:00Z' });
const can = () => true;
describe('notification follow-up presentation policy', () => {
 it.each([
  ['LOW_STOCK',{reference:'A & B'},'/inventory?search=A%20%26%20B'],
  ['OUT_OF_STOCK',{},'/inventory'],['EXPIRY_ALERT',{batch_id:'batch'},'/expiry?batchId=batch'],
  ['BATCH_ATTENTION',{batch_id:'batch'},'/expiry?batchId=batch'],['PURCHASE_FOLLOWUP',{order_id:'po'},'/purchasing?orderId=po'],
  ['TRANSFER_FOLLOWUP',{transfer_id:'tr'},'/transfers?transferId=tr'],['COUNT_FOLLOWUP',{count_id:'count'},'/inventory?countId=count'],['INVITATION_FOLLOWUP',{},'/staff'],['IMPORT_FAILED',{},'/operations'],
 ])('opens %s existing workflow', (type,payload,url) => expect(notificationDestination(row(type,payload),can)).toBe(url));
 it('removes inaccessible branch notifications', () => expect(notificationVisible(row('LOW_STOCK'),[{id:'b2'}],can)).toBe(false));
 it('keeps accessible branches independent of current selected branch', () => expect(notificationVisible(row('LOW_STOCK'),[{id:'b1'},{id:'b2'}],can)).toBe(true));
 it('supports clearly labelled organization-wide notifications', () => expect(notificationVisible({...row('LOW_STOCK'),branch_id:null},[],can)).toBe(true));
 it('hides role-inapplicable notifications and actions', () => { expect(notificationVisible(row('INVITATION_FOLLOWUP'),[{id:'b1'}],p=>p!=='staff.manage')).toBe(false); expect(notificationDestination(row('COUNT_FOLLOWUP'),()=>false)).toBeNull(); });
 it('does not send resolved history back to an obsolete task', () => expect(notificationDestination({...row('LOW_STOCK'),resolved_at:'now'},can)).toBeNull());
 it('has no action for unsupported or malformed event data', () => {expect(notificationDestination(row('UNKNOWN'),can)).toBeNull();expect(notificationDestination(row('EXPIRY_ALERT',null),can)).toBe('/expiry');});
 it('bounds pages to 25 and detects one extra row', () => {expect(notificationPage(Array.from({length:26},(_,i)=>i))).toEqual({items:Array.from({length:25},(_,i)=>i),hasMore:true});expect(notificationPage([1])).toEqual({items:[1],hasMore:false});});
});
