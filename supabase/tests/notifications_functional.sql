-- Disposable local fixture only. Seed realistic operational conditions; retain for browser QA.
begin;
create function pg_temp.notify_assert(v boolean,label text) returns void language plpgsql as $$ begin if v is distinct from true then raise exception 'FAILED notification: %',label; end if; end $$;
select set_config('request.jwt.claim.sub','66000000-0000-0000-0000-000000000001',true);
insert into public.organization_settings(organization_id,low_stock_default_threshold) values('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',5) on conflict(organization_id) do update set low_stock_default_threshold=5;
insert into public.expiry_policies(organization_id,thresholds_days) values('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',array[30,7]) on conflict(organization_id) do update set thresholds_days=array[30,7];
do $$
declare org uuid:='6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; br uuid:='6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa'; pr uuid; ba uuid; i integer;
begin
 for i in 1..30 loop
  insert into public.products(organization_id,name) values(org,'Follow-up product '||lpad(i::text,2,'0')) returning id into pr;
  insert into public.batches(organization_id,branch_id,product_id,lot_number,expiry_date,purchase_cost,selling_price) values(org,br,pr,'NOTIFY-'||i,current_date+365,2,4) returning id into ba;
  perform public.post_inventory_movement(org,br,ba,'ADJUSTMENT_IN',2,'notify-seed:'||i,'Local notification fixture');
 end loop;
 insert into public.products(organization_id,name) values(org,'Unknown stock has no balance');
 -- Mixed known/missing balances must not imply a definite low or zero quantity.
 select product_id into pr from public.batches where lot_number='NOTIFY-30';
 insert into public.batches(organization_id,branch_id,product_id,lot_number,expiry_date,purchase_cost,selling_price) values(org,br,pr,'MISSING-BALANCE',current_date+365,2,4);

end $$;
set local role authenticated;
select public.refresh_operational_notifications('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
do $$
declare org uuid:='6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; n integer; first_id uuid; ba uuid; pr uuid; count_id uuid; transfer_id uuid;
begin
 perform pg_temp.notify_assert((select count(*)>=29 from public.notifications where organization_id=org and resolved_at is null and type='LOW_STOCK'),'low stock across all products');
 perform pg_temp.notify_assert(not exists(select 1 from public.notifications where payload->>'reference'='Unknown stock has no balance'),'no invented zero');
 perform pg_temp.notify_assert(not exists(select 1 from public.notifications where payload->>'reference'='Follow-up product 30' and type in ('LOW_STOCK','OUT_OF_STOCK')),'mixed missing/known balances remain unknown');
 select count(*) into n from public.notifications where organization_id=org;
 perform public.refresh_operational_notifications(org); perform public.refresh_operational_notifications(org);
 perform pg_temp.notify_assert((select count(*)=n from public.notifications where organization_id=org),'refresh deduplicates');
 select id into first_id from public.notifications where payload->>'reference'='Follow-up product 01' and resolved_at is null;
 update public.notifications set read_at=now() where id=first_id;
 perform public.refresh_operational_notifications(org);
 perform pg_temp.notify_assert((select read_at is not null from public.notifications where id=first_id),'refresh preserves read state');
 update public.notifications set read_at=null where id=first_id;
 perform pg_temp.notify_assert((select read_at is null from public.notifications where id=first_id),'mark unread');
 select b.id,b.product_id into ba,pr from public.batches b where lot_number='NOTIFY-1';
 perform public.post_inventory_movement(org,'6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa',ba,'ADJUSTMENT_IN',10,'notify-replenish','Replenish test');
 perform public.refresh_operational_notifications(org);
 perform pg_temp.notify_assert((select resolved_at is not null and read_at is not null from public.notifications where id=first_id),'replenishment closes/read');
 perform public.post_inventory_movement(org,'6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa',ba,'ADJUSTMENT_OUT',-10,'notify-recur','Recurrence test');
 perform public.refresh_operational_notifications(org);
 perform pg_temp.notify_assert((select count(*)=1 from public.notifications where payload->>'reference'='Follow-up product 01' and resolved_at is null and read_at is null),'meaningful recurrence creates unread');
 perform public.post_inventory_movement(org,'6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa',ba,'ADJUSTMENT_OUT',-2,'notify-zero','Zero stock test');
 perform public.refresh_operational_notifications(org);
 perform pg_temp.notify_assert(exists(select 1 from public.notifications where type='OUT_OF_STOCK' and payload->>'product_id'=pr::text and resolved_at is null),'out-of-stock transition');
 update public.notifications set read_at=now() where organization_id=org and read_at is null and resolved_at is null;
 perform pg_temp.notify_assert(not exists(select 1 from public.notifications where organization_id=org and read_at is null and resolved_at is null),'mark all read');
 insert into public.notification_preferences(organization_id,user_id,in_app) values(org,auth.uid(),false) on conflict(organization_id,user_id) do update set in_app=false;
 perform public.refresh_operational_notifications(org);
 perform pg_temp.notify_assert(not exists(select 1 from public.notifications where resolved_at is null),'disabled preference closes conditions');
 select count(*) into n from public.notifications;
 perform public.refresh_operational_notifications(org);
 perform pg_temp.notify_assert((select count(*)=n from public.notifications),'disabled preference creates nothing');
 update public.notification_preferences set in_app=true where organization_id=org and user_id=auth.uid();
 perform public.refresh_operational_notifications(org);
 perform pg_temp.notify_assert(exists(select 1 from public.notifications where resolved_at is null and read_at is null),'reenabled current conditions');
end $$;
reset role;
-- These controlled state transitions verify inbox lifecycle, not domain mutation authorization.
do $$
declare org uuid:='6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; br uuid:='6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa'; second uuid:='6aaaaaaa-1111-1111-1111-aaaaaaaaaaa2'; supplier uuid;
begin
 insert into public.inventory_stock_counts(organization_id,branch_id,notes) values(org,br,'Notification review count');
 insert into public.stock_transfers(organization_id,source_branch_id,destination_branch_id,transfer_number,idempotency_key,requested_by,status) values(org,br,second,'NOTIFY-TRANSFER','notify-transfer',auth.uid(),'DISPATCHED');
 select id into supplier from public.suppliers where organization_id=org limit 1;
 insert into public.purchase_orders(organization_id,branch_id,supplier_id,po_number,status,created_by) values(org,br,supplier,'NOTIFY-PO','partially_received',auth.uid());
 insert into public.staff_invitations(organization_id,branch_id,email,display_name,role_id,invited_by) values(org,br,'notify@example.test','Invited teammate',(select id from public.roles where code='CASHIER' and organization_id is null),auth.uid());
end $$;
set local role authenticated;
select public.refresh_operational_notifications('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.notify_assert(exists(select 1 from public.notifications where type='COUNT_FOLLOWUP' and resolved_at is null),'open count');
select pg_temp.notify_assert(exists(select 1 from public.notifications where type='TRANSFER_FOLLOWUP' and branch_id='6aaaaaaa-1111-1111-1111-aaaaaaaaaaa2' and resolved_at is null),'incoming transfer correct branch');
select pg_temp.notify_assert(exists(select 1 from public.notifications where type='PURCHASE_FOLLOWUP' and resolved_at is null),'partial purchase followup');
select pg_temp.notify_assert(exists(select 1 from public.notifications where type='INVITATION_FOLLOWUP' and resolved_at is null),'pending invitation');
reset role;
update public.inventory_stock_counts set status='COMPLETED' where notes='Notification review count';
update public.stock_transfers set status='RECEIVED' where transfer_number='NOTIFY-TRANSFER';
update public.purchase_orders set status='received' where po_number='NOTIFY-PO';
update public.staff_invitations set status='accepted' where email='notify@example.test';
set local role authenticated;
select public.refresh_operational_notifications('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.notify_assert(not exists(select 1 from public.notifications where (payload->>'reference' in ('NOTIFY-TRANSFER','NOTIFY-PO','Invited teammate') or condition_key='count:'||(select id::text from public.inventory_stock_counts where notes='Notification review count')) and resolved_at is null),'completed workflows close');
-- Threshold changes alter expiry follow-ups without waiting for the expiry screen.
update public.expiry_policies set thresholds_days=array[1] where organization_id='6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select public.refresh_operational_notifications('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.notify_assert(not exists(select 1 from public.notifications where type='EXPIRY_ALERT' and (payload->>'days')::int>1 and resolved_at is null),'threshold removes stale expiry');
update public.expiry_policies set thresholds_days=array[90,30,7] where organization_id='6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select public.refresh_operational_notifications('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.notify_assert(exists(select 1 from public.notifications where type='EXPIRY_ALERT' and resolved_at is null),'expiry generated independently');
reset role;
-- Ordinary staff gets only existing operational capabilities and assigned branches.
select set_config('request.jwt.claim.sub','66000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select public.refresh_operational_notifications('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.notify_assert(not exists(select 1 from public.notifications where branch_id='6aaaaaaa-1111-1111-1111-aaaaaaaaaaa2'),'unassigned branch absent');
select pg_temp.notify_assert(not exists(select 1 from public.notifications where type in ('COUNT_FOLLOWUP','INVITATION_FOLLOWUP','TRANSFER_FOLLOWUP')),'cashier management followup absent');
reset role;
-- Remove the staff branch access and check normal list visibility immediately.
delete from public.branch_memberships where organization_membership_id='6a100000-0000-0000-0000-000000000002';
set local role authenticated;
select pg_temp.notify_assert(not exists(select 1 from public.notifications),'removed branch access hides history and badge source');
reset role;
insert into public.branch_memberships(branch_id,organization_membership_id) values('6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','6a100000-0000-0000-0000-000000000002');
-- A manager assigned only the destination can approve REQUESTED transfers.
update public.organization_memberships set role_id=(select id from public.roles where organization_id is null and code='INVENTORY_OFFICER') where id='6a100000-0000-0000-0000-000000000002';
delete from public.branch_memberships where organization_membership_id='6a100000-0000-0000-0000-000000000002';
insert into public.branch_memberships(branch_id,organization_membership_id) values('6aaaaaaa-1111-1111-1111-aaaaaaaaaaa2','6a100000-0000-0000-0000-000000000002');
update public.stock_transfers set status='REQUESTED' where transfer_number='NOTIFY-TRANSFER';
set local role authenticated;
select public.refresh_operational_notifications('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
-- Existing Inventory Officer role has transfer.approve in the accumulated seed.
select pg_temp.notify_assert(exists(select 1 from public.notifications where type='TRANSFER_FOLLOWUP' and payload->>'reference'='NOTIFY-TRANSFER' and branch_id='6aaaaaaa-1111-1111-1111-aaaaaaaaaaa2' and resolved_at is null),'destination-only approver');
reset role;
update public.organization_memberships set role_id=(select id from public.roles where organization_id is null and code='CASHIER') where id='6a100000-0000-0000-0000-000000000002';
delete from public.branch_memberships where organization_membership_id='6a100000-0000-0000-0000-000000000002';
insert into public.branch_memberships(branch_id,organization_membership_id) values('6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','6a100000-0000-0000-0000-000000000002');
-- Existing open identity follows the accessible endpoint when assignment changes.
select set_config('request.jwt.claim.sub','66000000-0000-0000-0000-000000000002',true);
update public.organization_memberships set role_id=(select id from public.roles where organization_id is null and code='INVENTORY_OFFICER') where id='6a100000-0000-0000-0000-000000000002';
select public.refresh_operational_notifications('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
delete from public.branch_memberships where organization_membership_id='6a100000-0000-0000-0000-000000000002';
insert into public.branch_memberships(branch_id,organization_membership_id) values('6aaaaaaa-1111-1111-1111-aaaaaaaaaaa2','6a100000-0000-0000-0000-000000000002');
set local role authenticated;
select public.refresh_operational_notifications('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.notify_assert(exists(select 1 from public.notifications where type='TRANSFER_FOLLOWUP' and payload->>'reference'='NOTIFY-TRANSFER' and branch_id='6aaaaaaa-1111-1111-1111-aaaaaaaaaaa2' and resolved_at is null),'same-recipient endpoint reassignment');
reset role;
update public.organization_memberships set role_id=(select id from public.roles where organization_id is null and code='CASHIER') where id='6a100000-0000-0000-0000-000000000002';
delete from public.branch_memberships where organization_membership_id='6a100000-0000-0000-0000-000000000002';
insert into public.branch_memberships(branch_id,organization_membership_id) values('6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','6a100000-0000-0000-0000-000000000002');
-- Existing failed import and safety status records are actionable sources.
select set_config('request.jwt.claim.sub','66000000-0000-0000-0000-000000000001',true);
insert into public.import_jobs(organization_id,import_type,file_name,status) values('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','PRODUCTS','Follow-up failed import.csv','FAILED');
update public.batches set status='QUARANTINED' where lot_number='NOTIFY-2';
set local role authenticated;
select public.refresh_operational_notifications('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.notify_assert(exists(select 1 from public.notifications where type='IMPORT_FAILED' and branch_id is null and resolved_at is null),'organization-wide failed import');
select pg_temp.notify_assert(exists(select 1 from public.notifications where type='BATCH_ATTENTION' and payload->>'reference' like '%NOTIFY-2' and resolved_at is null),'quarantine followup');
reset role;
update public.import_jobs set status='COMPLETED' where file_name='Follow-up failed import.csv';
update public.batches set status='DISPOSED' where lot_number='NOTIFY-2';
set local role authenticated;
select public.refresh_operational_notifications('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.notify_assert(not exists(select 1 from public.notifications where type='IMPORT_FAILED' and resolved_at is null),'resolved import closes');
select pg_temp.notify_assert(not exists(select 1 from public.notifications where type='BATCH_ATTENTION' and payload->>'reference' like '%NOTIFY-2' and resolved_at is null),'disposed safety condition closes');
reset role;
update public.batches set status='ACTIVE' where lot_number='NOTIFY-2';
-- Near-expiry days follow the branch calendar rather than the database calendar.
update public.branches set timezone='Pacific/Kiritimati' where id='6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
update public.batches set expiry_date=(now() at time zone 'Pacific/Kiritimati')::date where lot_number='NOTIFY-3';
set local role authenticated;
select public.refresh_operational_notifications('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.notify_assert(exists(select 1 from public.notifications where type='EXPIRY_ALERT' and payload->>'reference' like '%NOTIFY-3' and payload->>'days'='0' and resolved_at is null),'configured branch business date');
reset role;
update public.branches set timezone=null where id='6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
update public.batches set expiry_date=current_date+365 where lot_number='NOTIFY-3';
-- Retain active transfer/count/PO for real browser workflows.
select set_config('request.jwt.claim.sub','66000000-0000-0000-0000-000000000001',true);
update public.stock_transfers set status='DISPATCHED' where transfer_number='NOTIFY-TRANSFER';
update public.inventory_stock_counts set status='OPEN' where notes='Notification review count';
update public.purchase_orders set status='partially_received' where po_number='NOTIFY-PO';
update public.staff_invitations set status='pending' where email='notify@example.test';
select public.refresh_operational_notifications('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.notify_assert(not exists(select 1 from public.notifications where condition_key is not null and resolved_at is null group by organization_id,recipient_user_id,condition_key having count(*)>1),'one active occurrence per condition');
commit;
