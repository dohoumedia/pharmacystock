-- Sprint 4 purchasing/receiving regression tests.
-- Run only against an isolated/local Supabase test database. Everything is rolled back.

begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values
('44000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','purchase-owner@test.invalid','',now(),now(),now(),'{}','{}'),
('44000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','purchase-cashier@test.invalid','',now(),now(),now(),'{}','{}')
on conflict (id) do nothing;

insert into public.organizations(id,name,slug,country_code,currency_code,timezone,default_locale)
values ('eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Purchasing Pharmacy','purchasing-pharmacy','CI','XOF','Africa/Abidjan','fr')
on conflict (id) do nothing;

insert into public.branches(id,organization_id,name,code,country_code,timezone)
values ('eaaaaaaa-1111-1111-1111-aaaaaaaaaaaa','eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Main','MAIN','CI','Africa/Abidjan')
on conflict (id) do nothing;

insert into public.organization_memberships(id,organization_id,user_id,role_id,status) values
(
  'ea100000-0000-0000-0000-000000000001','eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','44000000-0000-0000-0000-000000000001',
  (select id from public.roles where organization_id is null and code='OWNER'),'active'
),
(
  'ea100000-0000-0000-0000-000000000002','eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','44000000-0000-0000-0000-000000000002',
  (select id from public.roles where organization_id is null and code='CASHIER'),'active'
)
on conflict (id) do nothing;

insert into public.branch_memberships(branch_id,organization_membership_id) values
('eaaaaaaa-1111-1111-1111-aaaaaaaaaaaa','ea100000-0000-0000-0000-000000000001'),
('eaaaaaaa-1111-1111-1111-aaaaaaaaaaaa','ea100000-0000-0000-0000-000000000002')
on conflict do nothing;

insert into public.products(id,organization_id,name,status)
values ('eaaaaaaa-2222-2222-2222-aaaaaaaaaaaa','eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Purchase Test Product','active')
on conflict (id) do nothing;

insert into public.suppliers(id,organization_id,name,status)
values ('eaaaaaaa-3333-3333-3333-aaaaaaaaaaaa','eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Test Supplier','active')
on conflict (id) do nothing;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','44000000-0000-0000-0000-000000000001',true);

-- Atomic PO creation creates the header and all lines together.
do $$
declare v_order uuid;
begin
  v_order := public.create_purchase_order(
    'eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'eaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
    'eaaaaaaa-3333-3333-3333-aaaaaaaaaaaa',
    'PO-TEST-001', current_date + 7, 'Regression order',
    jsonb_build_array(jsonb_build_object('product_id','eaaaaaaa-2222-2222-2222-aaaaaaaaaaaa','quantity',10,'unit_cost',1250)),
    'test:po:001'
  );
  if (select count(*) from public.purchase_orders where id=v_order) <> 1 then raise exception 'PUR-T-001 failed: order missing'; end if;
  if (select count(*) from public.purchase_order_lines where purchase_order_id=v_order) <> 1 then raise exception 'PUR-T-002 failed: order line missing'; end if;
end $$;

-- Replaying the same PO idempotency key returns the same operation rather than duplicating it.
do $$
declare v_first uuid; v_second uuid;
begin
  select id into v_first from public.purchase_orders where idempotency_key='test:po:001';
  v_second := public.create_purchase_order(
    'eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'eaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
    'eaaaaaaa-3333-3333-3333-aaaaaaaaaaaa',
    'PO-TEST-001', current_date + 7, 'Replay',
    jsonb_build_array(jsonb_build_object('product_id','eaaaaaaa-2222-2222-2222-aaaaaaaaaaaa','quantity',10,'unit_cost',1250)),
    'test:po:001'
  );
  if v_first <> v_second then raise exception 'PUR-T-003 failed: PO idempotency returned another ID'; end if;
  if (select count(*) from public.purchase_orders where idempotency_key='test:po:001') <> 1 then raise exception 'PUR-T-004 failed: duplicate PO created'; end if;
end $$;

-- Direct line mutation is blocked; quantities are controlled by domain RPCs.
do $$
begin
  begin
    update public.purchase_order_lines set received_quantity=9 where purchase_order_id=(select id from public.purchase_orders where idempotency_key='test:po:001');
    raise exception 'PUR-T-005 failed: direct received quantity update was allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Partial receipt creates a batch, exactly one ledger movement, and marks the PO partially received.
do $$
declare v_order uuid; v_line uuid; v_receipt uuid; v_batch uuid;
begin
  select id into v_order from public.purchase_orders where idempotency_key='test:po:001';
  select id into v_line from public.purchase_order_lines where purchase_order_id=v_order;
  v_receipt := public.receive_purchase_order(
    v_order,'RCPT-001','INV-001',
    jsonb_build_array(jsonb_build_object('purchase_order_line_id',v_line,'quantity',4,'unit_cost',1250,'lot_number','LOT-PUR-001','expiry_date',(current_date+365)::text)),
    'Partial receipt','test:receipt:001'
  );
  select batch_id into v_batch from public.purchase_receipt_lines where receipt_id=v_receipt;
  if (select status from public.purchase_orders where id=v_order) <> 'partially_received' then raise exception 'PUR-T-006 failed: PO not partial'; end if;
  if (select received_quantity from public.purchase_order_lines where id=v_line) <> 4 then raise exception 'PUR-T-007 failed: received quantity not 4'; end if;
  if (select on_hand_quantity from public.inventory_balances where batch_id=v_batch) <> 4 then raise exception 'PUR-T-008 failed: inventory balance not 4'; end if;
  if (select count(*) from public.inventory_movements where reference_type='PURCHASE_RECEIPT' and reference_id=v_receipt::text) <> 1 then raise exception 'PUR-T-009 failed: incorrect movement count'; end if;
  if not exists(
    select 1 from public.purchase_receipt_lines prl join public.inventory_movements im on im.id=prl.inventory_movement_id
    where prl.receipt_id=v_receipt and im.reference_id=v_receipt::text and im.quantity_delta=4
  ) then raise exception 'PUR-T-010 failed: receipt line not linked to ledger movement'; end if;
end $$;

-- Receipt retry with the same key is idempotent and does not increase stock twice.
do $$
declare v_order uuid; v_line uuid; v_first uuid; v_second uuid; v_batch uuid;
begin
  select id into v_order from public.purchase_orders where idempotency_key='test:po:001';
  select id into v_line from public.purchase_order_lines where purchase_order_id=v_order;
  select id into v_first from public.purchase_receipts where idempotency_key='test:receipt:001';
  v_second := public.receive_purchase_order(
    v_order,'RCPT-001','INV-001',
    jsonb_build_array(jsonb_build_object('purchase_order_line_id',v_line,'quantity',4,'unit_cost',1250,'lot_number','LOT-PUR-001','expiry_date',(current_date+365)::text)),
    'Retry','test:receipt:001'
  );
  select batch_id into v_batch from public.purchase_receipt_lines where receipt_id=v_first;
  if v_first <> v_second then raise exception 'PUR-T-011 failed: receipt retry returned another ID'; end if;
  if (select on_hand_quantity from public.inventory_balances where batch_id=v_batch) <> 4 then raise exception 'PUR-T-012 failed: retry duplicated stock'; end if;
end $$;

-- Over-receiving is rejected atomically: no receipt or stock mutation survives.
do $$
declare v_order uuid; v_line uuid; v_before numeric; v_receipts integer;
begin
  select id into v_order from public.purchase_orders where idempotency_key='test:po:001';
  select id into v_line from public.purchase_order_lines where purchase_order_id=v_order;
  select coalesce(sum(on_hand_quantity),0) into v_before from public.inventory_balances where organization_id='eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  select count(*) into v_receipts from public.purchase_receipts where purchase_order_id=v_order;
  begin
    perform public.receive_purchase_order(
      v_order,'RCPT-OVER','INV-OVER',
      jsonb_build_array(jsonb_build_object('purchase_order_line_id',v_line,'quantity',7,'unit_cost',1250,'lot_number','LOT-PUR-001','expiry_date',(current_date+365)::text)),
      'Must fail','test:receipt:over'
    );
    raise exception 'PUR-T-013 failed: over-receipt was allowed';
  exception when check_violation then null;
  end;
  if (select count(*) from public.purchase_receipts where purchase_order_id=v_order) <> v_receipts then raise exception 'PUR-T-014 failed: failed receipt persisted'; end if;
  if (select coalesce(sum(on_hand_quantity),0) from public.inventory_balances where organization_id='eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') <> v_before then raise exception 'PUR-T-015 failed: failed receipt changed stock'; end if;
end $$;

-- Final receipt completes the order, reuses the same physical batch, and reaches stock 10.
do $$
declare v_order uuid; v_line uuid; v_receipt uuid; v_batch uuid;
begin
  select id into v_order from public.purchase_orders where idempotency_key='test:po:001';
  select id into v_line from public.purchase_order_lines where purchase_order_id=v_order;
  v_receipt := public.receive_purchase_order(
    v_order,'RCPT-002','INV-002',
    jsonb_build_array(jsonb_build_object('purchase_order_line_id',v_line,'quantity',6,'unit_cost',1250,'lot_number','LOT-PUR-001','expiry_date',(current_date+365)::text)),
    'Final receipt','test:receipt:002'
  );
  select batch_id into v_batch from public.purchase_receipt_lines where receipt_id=v_receipt;
  if (select status from public.purchase_orders where id=v_order) <> 'received' then raise exception 'PUR-T-016 failed: PO not received'; end if;
  if (select received_quantity from public.purchase_order_lines where id=v_line) <> 10 then raise exception 'PUR-T-017 failed: final received quantity not 10'; end if;
  if (select on_hand_quantity from public.inventory_balances where batch_id=v_batch) <> 10 then raise exception 'PUR-T-018 failed: final stock not 10'; end if;
  if (select count(*) from public.batches where organization_id='eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and lot_number='LOT-PUR-001') <> 1 then raise exception 'PUR-T-019 failed: matching batch was duplicated'; end if;
end $$;

-- A completed order cannot receive another distinct delivery.
do $$
declare v_order uuid; v_line uuid;
begin
  select id into v_order from public.purchase_orders where idempotency_key='test:po:001';
  select id into v_line from public.purchase_order_lines where purchase_order_id=v_order;
  begin
    perform public.receive_purchase_order(
      v_order,'RCPT-003','INV-003',
      jsonb_build_array(jsonb_build_object('purchase_order_line_id',v_line,'quantity',1,'unit_cost',1250,'lot_number','LOT-X','expiry_date',(current_date+365)::text)),
      'Must fail','test:receipt:003'
    );
    raise exception 'PUR-T-020 failed: completed PO accepted receipt';
  exception when check_violation then null;
  end;
end $$;

-- Cashier cannot create or receive purchases even with branch membership.
select set_config('request.jwt.claim.sub','44000000-0000-0000-0000-000000000002',true);
do $$
declare v_order uuid; v_line uuid;
begin
  select id into v_order from public.purchase_orders where idempotency_key='test:po:001';
  select id into v_line from public.purchase_order_lines where purchase_order_id=v_order;
  begin
    perform public.create_purchase_order(
      'eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','eaaaaaaa-1111-1111-1111-aaaaaaaaaaaa','eaaaaaaa-3333-3333-3333-aaaaaaaaaaaa',
      'PO-CASHIER',current_date+7,null,
      jsonb_build_array(jsonb_build_object('product_id','eaaaaaaa-2222-2222-2222-aaaaaaaaaaaa','quantity',1,'unit_cost',1)),
      'test:cashier:po'
    );
    raise exception 'PUR-T-021 failed: cashier created PO';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.receive_purchase_order(
      v_order,'RCPT-CASHIER',null,
      jsonb_build_array(jsonb_build_object('purchase_order_line_id',v_line,'quantity',1,'lot_number','LOT-CASHIER','expiry_date',(current_date+365)::text)),
      null,'test:cashier:receipt'
    );
    raise exception 'PUR-T-022 failed: cashier received PO';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
rollback;
