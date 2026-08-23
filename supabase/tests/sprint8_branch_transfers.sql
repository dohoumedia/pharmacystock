-- Sprint 8 multi-branch transfer regression tests. Run only on an isolated database; rolled back.
begin;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) values
('88000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s8-source@test.invalid','',now(),now(),now(),'{}','{}'),
('88000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s8-destination@test.invalid','',now(),now(),now(),'{}','{}'),
('88000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s8-unrelated@test.invalid','',now(),now(),now(),'{}','{}')
on conflict(id) do nothing;

insert into public.organizations(id,name,slug) values
('88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Sprint 8 Pharmacy','s8-pharmacy') on conflict(id) do nothing;
insert into public.branches(id,organization_id,name,code) values
('88aaaaaa-1111-1111-1111-aaaaaaaaaaaa','88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Source','SRC'),
('88aaaaaa-2222-2222-2222-aaaaaaaaaaaa','88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Destination','DST'),
('88aaaaaa-3333-3333-3333-aaaaaaaaaaaa','88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Unrelated','OTH')
on conflict(id) do nothing;

insert into public.organization_memberships(id,organization_id,user_id,role_id,status) values
('88100000-0000-0000-0000-000000000001','88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','88000000-0000-0000-0000-000000000001',(select id from public.roles where organization_id is null and code='INVENTORY_OFFICER'),'active'),
('88100000-0000-0000-0000-000000000002','88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','88000000-0000-0000-0000-000000000002',(select id from public.roles where organization_id is null and code='INVENTORY_OFFICER'),'active'),
('88100000-0000-0000-0000-000000000003','88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','88000000-0000-0000-0000-000000000003',(select id from public.roles where organization_id is null and code='INVENTORY_OFFICER'),'active')
on conflict(id) do nothing;
insert into public.branch_memberships(branch_id,organization_membership_id) values
('88aaaaaa-1111-1111-1111-aaaaaaaaaaaa','88100000-0000-0000-0000-000000000001'),
('88aaaaaa-2222-2222-2222-aaaaaaaaaaaa','88100000-0000-0000-0000-000000000002'),
('88aaaaaa-3333-3333-3333-aaaaaaaaaaaa','88100000-0000-0000-0000-000000000003')
on conflict do nothing;

insert into public.products(id,organization_id,name,sku,status) values
('88aaaaaa-4444-4444-4444-aaaaaaaaaaaa','88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Sprint 8 Product','S8-001','active') on conflict(id) do nothing;
insert into public.batches(id,organization_id,branch_id,product_id,lot_number,expiry_date,purchase_cost,selling_price,status) values
('88aaaaaa-5555-5555-5555-aaaaaaaaaaaa','88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','88aaaaaa-1111-1111-1111-aaaaaaaaaaaa','88aaaaaa-4444-4444-4444-aaaaaaaaaaaa','S8-LOT',current_date+365,500,800,'ACTIVE') on conflict(id) do nothing;
insert into public.inventory_movements(organization_id,branch_id,batch_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,idempotency_key,reason,created_by)
values('88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','88aaaaaa-1111-1111-1111-aaaaaaaaaaaa','88aaaaaa-5555-5555-5555-aaaaaaaaaaaa','ADJUSTMENT_IN',10,500,'TEST','S8','s8:opening','Sprint 8 opening stock','88000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','88000000-0000-0000-0000-000000000001',true);

select public.create_stock_transfer(
 '88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','88aaaaaa-1111-1111-1111-aaaaaaaaaaaa','88aaaaaa-2222-2222-2222-aaaaaaaaaaaa','TR-S8-001',
 jsonb_build_array(jsonb_build_object('source_batch_id','88aaaaaa-5555-5555-5555-aaaaaaaaaaaa','quantity',6)),
 's8:transfer:001','First branch transfer');

-- Same idempotency key must resolve to the original transfer.
do $$ declare a uuid; b uuid; begin
 select id into a from public.stock_transfers where organization_id='88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and transfer_number='TR-S8-001';
 b:=public.create_stock_transfer('88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','88aaaaaa-1111-1111-1111-aaaaaaaaaaaa','88aaaaaa-2222-2222-2222-aaaaaaaaaaaa','TR-S8-RETRY',jsonb_build_array(jsonb_build_object('source_batch_id','88aaaaaa-5555-5555-5555-aaaaaaaaaaaa','quantity',1)),'s8:transfer:001','retry');
 if a<>b then raise exception 'S8-T-001 transfer idempotency failed'; end if;
end $$;

select public.approve_stock_transfer((select id from public.stock_transfers where transfer_number='TR-S8-001'));
select public.dispatch_stock_transfer((select id from public.stock_transfers where transfer_number='TR-S8-001'));

do $$ begin
 if coalesce((select on_hand_quantity from public.inventory_balances where organization_id='88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and branch_id='88aaaaaa-1111-1111-1111-aaaaaaaaaaaa' and batch_id='88aaaaaa-5555-5555-5555-aaaaaaaaaaaa'),0)<>4 then raise exception 'S8-T-002 dispatch did not reduce source stock'; end if;
 if not exists(select 1 from public.inventory_movements where organization_id='88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and movement_type='TRANSFER_OUT' and reference_type='STOCK_TRANSFER' and quantity_delta=-6) then raise exception 'S8-T-003 transfer-out ledger movement missing'; end if;
end $$;

select set_config('request.jwt.claim.sub','88000000-0000-0000-0000-000000000002',true);
select public.receive_stock_transfer(
 (select id from public.stock_transfers where transfer_number='TR-S8-001'),
 jsonb_build_array(jsonb_build_object('line_id',(select id from public.stock_transfer_lines where transfer_id=(select id from public.stock_transfers where transfer_number='TR-S8-001')),'quantity',5,'reason','one unit damaged in transit')),
 'Carrier discrepancy recorded');

do $$ begin
 if (select status from public.stock_transfers where transfer_number='TR-S8-001')<>'RECEIVED_WITH_DISCREPANCY' then raise exception 'S8-T-004 discrepancy status failed'; end if;
 if (select discrepancy_quantity from public.stock_transfer_lines where transfer_id=(select id from public.stock_transfers where transfer_number='TR-S8-001'))<>1 then raise exception 'S8-T-005 discrepancy quantity failed'; end if;
 if coalesce((select sum(on_hand_quantity) from public.inventory_balances where organization_id='88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and branch_id='88aaaaaa-2222-2222-2222-aaaaaaaaaaaa'),0)<>5 then raise exception 'S8-T-006 destination stock receipt failed'; end if;
 if not exists(select 1 from public.inventory_movements where organization_id='88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and movement_type='TRANSFER_IN' and quantity_delta=5) then raise exception 'S8-T-007 transfer-in ledger movement missing'; end if;
end $$;

-- A member scoped to an unrelated branch must neither see nor approve/cancel the transfer.
select set_config('request.jwt.claim.sub','88000000-0000-0000-0000-000000000003',true);
do $$ begin
 if exists(select 1 from public.stock_transfers where transfer_number='TR-S8-001') then raise exception 'S8-T-008 transfer RLS branch isolation failed'; end if;
 if exists(select 1 from public.stock_transfer_lines where organization_id='88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') then raise exception 'S8-T-009 transfer-line RLS branch isolation failed'; end if;
end $$;

-- Create another requested transfer as the source user, then verify unrelated approval is blocked.
select set_config('request.jwt.claim.sub','88000000-0000-0000-0000-000000000001',true);
select public.create_stock_transfer(
 '88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','88aaaaaa-1111-1111-1111-aaaaaaaaaaaa','88aaaaaa-2222-2222-2222-aaaaaaaaaaaa','TR-S8-002',
 jsonb_build_array(jsonb_build_object('source_batch_id','88aaaaaa-5555-5555-5555-aaaaaaaaaaaa','quantity',1)),
 's8:transfer:002',null);
select set_config('request.jwt.claim.sub','88000000-0000-0000-0000-000000000003',true);
do $$ begin
 begin
  perform public.approve_stock_transfer((select id from public.stock_transfers where transfer_number='TR-S8-002'));
  raise exception 'S8-T-010 unrelated branch approval was allowed';
 exception when insufficient_privilege then null; end;
end $$;

-- Input validation must reject blank transfer numbers.
select set_config('request.jwt.claim.sub','88000000-0000-0000-0000-000000000001',true);
do $$ begin
 begin
  perform public.create_stock_transfer('88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','88aaaaaa-1111-1111-1111-aaaaaaaaaaaa','88aaaaaa-2222-2222-2222-aaaaaaaaaaaa','   ',jsonb_build_array(jsonb_build_object('source_batch_id','88aaaaaa-5555-5555-5555-aaaaaaaaaaaa','quantity',1)),'s8:blank-number',null);
  raise exception 'S8-T-011 blank transfer number was allowed';
 exception when check_violation then null; end;
end $$;

reset role;
rollback;
