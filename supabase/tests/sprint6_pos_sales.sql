-- Sprint 6 POS / sales regression tests. Run only on an isolated database; rolled back.
begin;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) values
('66000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pos-owner@test.invalid','',now(),now(),now(),'{}','{}'),
('66000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pos-cashier@test.invalid','',now(),now(),now(),'{}','{}')
on conflict(id) do nothing;
insert into public.organizations(id,name,slug) values('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','POS Test Pharmacy','pos-test-pharmacy') on conflict(id) do nothing;
insert into public.branches(id,organization_id,name,code) values('6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Main','MAIN') on conflict(id) do nothing;
insert into public.organization_memberships(id,organization_id,user_id,role_id,status) values
('6a100000-0000-0000-0000-000000000001','6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','66000000-0000-0000-0000-000000000001',(select id from public.roles where organization_id is null and code='OWNER'),'active'),
('6a100000-0000-0000-0000-000000000002','6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','66000000-0000-0000-0000-000000000002',(select id from public.roles where organization_id is null and code='CASHIER'),'active')
on conflict(id) do nothing;
insert into public.branch_memberships(branch_id,organization_membership_id) values
('6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','6a100000-0000-0000-0000-000000000001'),
('6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','6a100000-0000-0000-0000-000000000002') on conflict do nothing;
insert into public.products(id,organization_id,name,status) values('6aaaaaaa-2222-2222-2222-aaaaaaaaaaaa','6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','POS Product','active') on conflict(id) do nothing;
insert into public.batches(id,organization_id,branch_id,product_id,lot_number,expiry_date,purchase_cost,selling_price,status) values
('6aaaaaaa-3333-3333-3333-aaaaaaaaaaa1','6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','6aaaaaaa-2222-2222-2222-aaaaaaaaaaaa','FEFO-1',current_date+20,700,1000,'ACTIVE'),
('6aaaaaaa-3333-3333-3333-aaaaaaaaaaa2','6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','6aaaaaaa-2222-2222-2222-aaaaaaaaaaaa','FEFO-2',current_date+60,800,1200,'ACTIVE'),
('6aaaaaaa-3333-3333-3333-aaaaaaaaaaa3','6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','6aaaaaaa-2222-2222-2222-aaaaaaaaaaaa','EXPIRED',current_date-1,500,500,'EXPIRED')
on conflict(id) do nothing;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','66000000-0000-0000-0000-000000000001',true);
select public.post_inventory_movement('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','6aaaaaaa-3333-3333-3333-aaaaaaaaaaa1','PURCHASE_RECEIPT',2,'pos-seed:1','seed');
select public.post_inventory_movement('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','6aaaaaaa-3333-3333-3333-aaaaaaaaaaa2','PURCHASE_RECEIPT',3,'pos-seed:2','seed');
select public.post_inventory_movement('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','6aaaaaaa-3333-3333-3333-aaaaaaaaaaa3','PURCHASE_RECEIPT',9,'pos-seed:expired','seed');

select set_config('request.jwt.claim.sub','66000000-0000-0000-0000-000000000002',true);
do $$ declare q jsonb; begin
  q:=public.quote_sale('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa',jsonb_build_array(jsonb_build_object('product_id','6aaaaaaa-2222-2222-2222-aaaaaaaaaaaa','quantity',4)));
  if (q->>'total_amount')::numeric <> 4400 then raise exception 'POS-T-001 quote total expected 4400, got %',q->>'total_amount'; end if;
  if jsonb_array_length(q->'items') <> 2 then raise exception 'POS-T-002 FEFO quote should span two valid batches'; end if;
  if (q->'items'->0->>'batch_id')::uuid <> '6aaaaaaa-3333-3333-3333-aaaaaaaaaaa1' then raise exception 'POS-T-003 FEFO first batch incorrect'; end if;
end $$;

select public.complete_sale(
  '6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','SALE-POS-001',
  jsonb_build_array(jsonb_build_object('product_id','6aaaaaaa-2222-2222-2222-aaaaaaaaaaaa','quantity',4)),
  jsonb_build_array(jsonb_build_object('method','CASH','amount',4400)),
  'pos:sale:001','test sale'
);

do $$ declare v_sale uuid; v_again uuid; begin
  select id into v_sale from public.sales where organization_id='6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and sale_number='SALE-POS-001';
  if v_sale is null then raise exception 'POS-T-004 sale missing'; end if;
  if (select total_amount from public.sales where id=v_sale) <> 4400 then raise exception 'POS-T-005 sale total wrong'; end if;
  if (select count(*) from public.sale_items where sale_id=v_sale) <> 2 then raise exception 'POS-T-006 expected two FEFO sale items'; end if;
  if coalesce((select on_hand_quantity from public.inventory_balances where batch_id='6aaaaaaa-3333-3333-3333-aaaaaaaaaaa1'),0) <> 0 then raise exception 'POS-T-007 first batch not depleted'; end if;
  if coalesce((select on_hand_quantity from public.inventory_balances where batch_id='6aaaaaaa-3333-3333-3333-aaaaaaaaaaa2'),0) <> 1 then raise exception 'POS-T-008 second batch balance expected 1'; end if;
  if coalesce((select on_hand_quantity from public.inventory_balances where batch_id='6aaaaaaa-3333-3333-3333-aaaaaaaaaaa3'),0) <> 9 then raise exception 'POS-T-009 expired batch must remain untouched'; end if;
  v_again:=public.complete_sale('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','SALE-POS-001',jsonb_build_array(jsonb_build_object('product_id','6aaaaaaa-2222-2222-2222-aaaaaaaaaaaa','quantity',4)),jsonb_build_array(jsonb_build_object('method','CASH','amount',4400)),'pos:sale:001','retry');
  if v_again<>v_sale then raise exception 'POS-T-010 sale idempotency failed'; end if;
end $$;

do $$ begin
  begin
    perform public.complete_sale('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','SALE-POS-BADPAY',jsonb_build_array(jsonb_build_object('product_id','6aaaaaaa-2222-2222-2222-aaaaaaaaaaaa','quantity',1)),jsonb_build_array(jsonb_build_object('method','CASH','amount',1)),'pos:sale:badpay','bad payment');
    raise exception 'POS-T-011 mismatched payment was accepted';
  exception when check_violation then null;
  end;
  if exists(select 1 from public.sales where sale_number='SALE-POS-BADPAY') then raise exception 'POS-T-012 failed sale leaked transaction state'; end if;
end $$;

-- Cashier cannot refund.
do $$ declare v_sale uuid; v_item uuid; begin
  select id into v_sale from public.sales where sale_number='SALE-POS-001';
  select id into v_item from public.sale_items where sale_id=v_sale order by created_at limit 1;
  begin
    perform public.refund_sale(v_sale,'REF-POS-DENIED',jsonb_build_array(jsonb_build_object('sale_item_id',v_item,'quantity',1)),'pos:refund:denied','cashier should fail');
    raise exception 'POS-T-013 cashier refund was accepted';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub','66000000-0000-0000-0000-000000000001',true);
do $$ declare v_sale uuid; v_item uuid; v_refund uuid; begin
  select id into v_sale from public.sales where sale_number='SALE-POS-001';
  select id into v_item from public.sale_items where sale_id=v_sale order by created_at limit 1;
  v_refund:=public.refund_sale(v_sale,'REF-POS-001',jsonb_build_array(jsonb_build_object('sale_item_id',v_item,'quantity',1)),'pos:refund:001','customer return');
  if v_refund is null then raise exception 'POS-T-014 refund missing'; end if;
  if (select status from public.sales where id=v_sale) <> 'PARTIALLY_REFUNDED' then raise exception 'POS-T-015 sale status not partially refunded'; end if;
  if coalesce((select on_hand_quantity from public.inventory_balances where batch_id='6aaaaaaa-3333-3333-3333-aaaaaaaaaaa1'),0) <> 1 then raise exception 'POS-T-016 refund did not restore batch quantity'; end if;
  if not exists(select 1 from public.inventory_movements where reference_type='sale_refund' and movement_type='RETURN_IN' and quantity_delta=1) then raise exception 'POS-T-017 refund movement missing'; end if;
end $$;

reset role;
rollback;
