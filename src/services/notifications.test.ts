import { markAllNotificationsRead, notificationList, notificationUnreadCount, refreshNotificationConditions, setNotificationRead } from './notifications';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], calls: [] as unknown[][], error: false, rpc: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { rpc: f.rpc, from: (table: string) => {
 f.calls.push(['from',table]); const filters: [string,unknown][]=[];let body: Record<string,unknown>|null=null;let start=0,end=Infinity,head=false,one=false;
 const q = {
  select: (...args: unknown[]) => {f.calls.push(['select',...args]);head=Boolean((args[1] as {head?:boolean})?.head);return q;},
  eq: (key:string,value:unknown) => {filters.push([key,value]);return q;}, is: (key:string,value:unknown) => {filters.push([key,value]);return q;},
  order: (...args:unknown[]) => {f.calls.push(['order',...args]);return q;}, range:(a:number,b:number)=>{start=a;end=b;f.calls.push(['range',a,b]);return q;},
  update:(value:Record<string,unknown>)=>{body=value;return q;},single:()=>{one=true;return q;},
  then:(resolve:(value:unknown)=>unknown)=>{const rows=f.rows.filter(r=>filters.every(([k,v])=>r[k]===v));if(body&&!f.error)rows.forEach(r=>Object.assign(r,body));return Promise.resolve(resolve({data:head?null:one?rows[0]:rows.slice(start,end+1),count:rows.length,error:f.error||one&&!rows.length?{message:'save failed'}:null}));},
 }; return q;
} } }));
beforeEach(()=>{f.error=false;f.calls=[];f.rpc.mockReset();f.rpc.mockResolvedValue({error:null});f.rows=Array.from({length:53},(_,i)=>({id:String(i),organization_id:'org',recipient_user_id:'u',read_at:i===0?'read':null,resolved_at:i===1?'closed':null}));f.rows.push({id:'foreign',organization_id:'other',recipient_user_id:'other',read_at:null,resolved_at:null});});
describe('existing notification service integration',()=>{
 it('lists only the current organization and recipient',async()=>{const result=await notificationList('org','u',false);expect(result.items).toHaveLength(25);expect(result.hasMore).toBe(true);expect(result.items.some(n=>n.id==='foreign')).toBe(false);});
 it('loads bounded subsequent pages with a stable timestamp/id order',async()=>{const result=await notificationList('org','u',false,2);expect(result.items.map(n=>n.id)).toEqual(['50','51','52']);expect(result.hasMore).toBe(false);expect(f.calls).toContainEqual(['range',50,75]);expect(f.calls).toContainEqual(['order','id',{ascending:false}]);});
 it('filters unread unresolved rows',async()=>{expect((await notificationList('org','u',true)).items[0]?.id).toBe('2');});
 it('counts all unread beyond the first page',async()=>{expect(await notificationUnreadCount('org','u')).toBe(51);expect(f.calls).toContainEqual(['select','id',{count:'exact',head:true}]);});
 it('marks exactly one read and unread',async()=>{await setNotificationRead('org','u','2',true);expect(f.rows[2]?.read_at).toBeTruthy();expect(f.rows[3]?.read_at).toBeNull();await setNotificationRead('org','u','2',false);expect(f.rows[2]?.read_at).toBeNull();});
 it('marks all current unread read without touching foreign rows',async()=>{await markAllNotificationsRead('org','u');expect(await notificationUnreadCount('org','u')).toBe(0);expect(f.rows.at(-1)?.read_at).toBeNull();expect(f.rows[1]?.read_at).toBeNull();});
 it('refuses to reopen resolved history or pretend an unavailable update succeeded',async()=>{await expect(setNotificationRead('org','u','1',false)).rejects.toBeTruthy();});
 it('uses the existing preference-aware reconciliation RPC',async()=>{await refreshNotificationConditions('org');expect(f.rpc).toHaveBeenCalledWith('refresh_operational_notifications',{p_organization_id:'org'});});
 it('propagates list/read errors for retry presentation',async()=>{f.error=true;await expect(notificationList('org','u',false)).rejects.toBeTruthy();await expect(markAllNotificationsRead('org','u')).rejects.toBeTruthy();});
 it('supports an empty inbox and zero badge',async()=>{f.rows=[];expect(await notificationList('org','u',false)).toEqual({items:[],hasMore:false});expect(await notificationUnreadCount('org','u')).toBe(0);});
 it('rejects invalid page indexes',async()=>{await expect(notificationList('org','u',false,-1)).rejects.toThrow('NOTIFICATION_PAGE_INVALID');});
});
