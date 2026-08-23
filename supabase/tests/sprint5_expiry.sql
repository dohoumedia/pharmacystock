-- Sprint 5 expiry / FEFO regression tests. Run only on an isolated database; rolled back.
begin;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) values
('55000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','expiry-owner@test.invalid','',now(),now(),now(),'{}','{}'),
('55000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','expiry-cashier@test.invalid','',now(),now(),now(),'{}','{}')
on conflict(id) do nothing;
insert into public.organizations(id,name,slug) values('faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Expiry Test Pharmacy','expiry-test-pharmacy') on conflict(id) do nothing;
insert into public.branches(id,organization_id,name,code) values('faaaaaaa-1111-1111-1111-aaaaaaaaaaaa','faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Main','MAIN') on conflict(id) do nothing;
insert into public.organization_memberships(id,organization_id,user_id,role_id,status) values
('fa100000-0000-0000-0000-000000000001','faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','55000000-0000-0000-0000-000000000001',(select id from public.roles where organization_id is null and code='OWNER'),'active'),
('fa100000-0000-0000-0000-000000000002','faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','55000000-0000-0000-0000-000000000002',(select id from public.roles where organization_id is null and code='CASHIER'),'active')
on conflict(id) do nothing;
insert into public.branch_memberships(branch_id,organization_membership_id) values
('faaaaaaa-1111-1111-1111-aaaaaaaaaaaa','fa100000-0000-0000-0000-000000000001'),
('faaaaaaa-1111-1111-1111-aaaaaaaaaaaa','fa100000-0000-0000-0000-000000000002') on conflict do nothing;
insert into public.products(id,organization_id,name,status) values('faaaaaaa-2222-2222-2222-aaaaaaaaaaaa','faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Expiry Product','active') on conflict(id) do nothing;
insert into public.batches(id,organization_id,branch_id,product_id,lot_number,expiry_date,purchase_cost,status) values
('faaaaaaa-3333-3333-3333-aaaaaaaaaaa1','faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','faaaaaaa-1111-1111-1111-aaaaaaaaaaaa','faaaaaaa-2222-2222-2222-aaaaaaaaaaaa','LOT-20',current_date+20,1000,'ACTIVE'),
('faaaaaaa-3333-3333-3333-aaaaaaaaaaa2','faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','faaaaaaa-1111-1111-1111-aaaaaaaaaaaa','faaaaaaa-2222-2222-2222-aaaaaaaaaaaa','LOT-60',current_date+60,1000,'ACTIVE'),
('faaaaaaa-3333-3333-3333-aaaaaaaaaaa3','faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','faaaaaaa-1111-1111-1111-aaaaaaaaaaaa','faaaaaaa-2222-2222-2222-aaaaaaaaaaaa','LOT-OLD',current_date-1,1000,'ACTIVE')
on conflict(id) do nothing;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','55000000-0000-0000-0000-000000000001',true);
select public.post_inventory_movement('faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','faaaaaaa-1111-1111-1111-aaaaaaaaaaaa','faaaaaaa-3333-3333-3333-aaaaaaaaaaa1','PURCHASE_RECEIPT',5,'expiry-test:20','seed');
select public.post_inventory_movement('faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','faaaaaaa-1111-1111-1111-aaaaaaaaaaaa','faaaaaaa-3333-3333-3333-aaaaaaaaaaa2','PURCHASE_RECEIPT',8,'expiry-test:60','seed');
select public.post_inventory_movement('faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','faaaaaaa-1111-1111-1111-aaaaaaaaaaaa','faaaaaaa-3333-3333-3333-aaaaaaaaaaa3','PURCHASE_RECEIPT',2,'expiry-test:old','seed');

do $$ declare v_first uuid; v_alerts integer; begin
  select batch_id into v_first from public.get_fefo_batches('faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','faaaaaaa-1111-1111-1111-aaaaaaaaaaaa','faaaaaaa-2222-2222-2222-aaaaaaaaaaaa') limit 1;
  if v_first <> 'faaaaaaa-3333-3333-3333-aaaaaaaaaaa1' then raise exception 'EXP-T-001 FEFO failed'; end if;
  v_alerts := public.refresh_expiry_alerts('faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','faaaaaaa-1111-1111-1111-aaaaaaaaaaaa');
  if v_alerts <> 3 then raise exception 'EXP-T-002 expected 3 alerts, got %',v_alerts; end if;
  if (select status from public.batches where id='faaaaaaa-3333-3333-3333-aaaaaaaaaaa3') <> 'EXPIRED' then raise exception 'EXP-T-003 expired status refresh failed'; end if;
  if not exists(select 1 from public.expiry_alerts where batch_id='faaaaaaa-3333-3333-3333-aaaaaaaaaaa1' and threshold_days=30) then raise exception 'EXP-T-004 30-day alert missing'; end if;
  if not exists(select 1 from public.expiry_alerts where batch_id='faaaaaaa-3333-3333-3333-aaaaaaaaaaa2' and threshold_days=60) then raise exception 'EXP-T-005 60-day alert missing'; end if;
  if not exists(select 1 from public.expiry_alerts where batch_id='faaaaaaa-3333-3333-3333-aaaaaaaaaaa3' and alert_type='EXPIRED') then raise exception 'EXP-T-006 expired alert missing'; end if;
end $$;

select public.record_expiry_action('faaaaaaa-3333-3333-3333-aaaaaaaaaaa1','QUARANTINE','qa');
do $$ declare v_first uuid; begin
  select batch_id into v_first from public.get_fefo_batches('faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','faaaaaaa-1111-1111-1111-aaaaaaaaaaaa','faaaaaaa-2222-2222-2222-aaaaaaaaaaaa') limit 1;
  if v_first <> 'faaaaaaa-3333-3333-3333-aaaaaaaaaaa2' then raise exception 'EXP-T-007 quarantine not excluded from FEFO'; end if;
end $$;
select public.record_expiry_action('faaaaaaa-3333-3333-3333-aaaaaaaaaaa1','RELEASE_QUARANTINE','qa');
select public.return_batch_to_supplier('faaaaaaa-3333-3333-3333-aaaaaaaaaaa1',2,'near expiry return','expiry:return:1');
do $$ begin
  if (select on_hand_quantity from public.inventory_balances where batch_id='faaaaaaa-3333-3333-3333-aaaaaaaaaaa1') <> 3 then raise exception 'EXP-T-008 supplier return balance failed'; end if;
end $$;
select public.dispose_batch('faaaaaaa-3333-3333-3333-aaaaaaaaaaa1','expired-risk disposal','expiry:dispose:1');
do $$ begin
  if coalesce((select on_hand_quantity from public.inventory_balances where batch_id='faaaaaaa-3333-3333-3333-aaaaaaaaaaa1'),0) <> 0 then raise exception 'EXP-T-009 disposal balance failed'; end if;
  if (select status from public.batches where id='faaaaaaa-3333-3333-3333-aaaaaaaaaaa1') <> 'DISPOSED' then raise exception 'EXP-T-010 disposal status failed'; end if;
end $$;

select set_config('request.jwt.claim.sub','55000000-0000-0000-0000-000000000002',true);
do $$ begin
  begin
    perform public.record_expiry_action('faaaaaaa-3333-3333-3333-aaaaaaaaaaa2','QUARANTINE','cashier must fail');
    raise exception 'EXP-T-011 cashier managed expiry';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
rollback;
