-- Sprint 6 POS / sales regression tests. Run only on an isolated database; rolled back.
begin;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) values
('66000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pos-owner@test.invalid','',now(),now(),now(),'{}','{}'),
('66000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pos-cashier@test.invalid','',now(),now(),now(),'{}','{}')
on conflict(id) do nothing;
insert into public.organizations(id,name,slug,currency_code) values('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','POS Test Pharmacy','pos-test-pharmacy','CAD') on conflict(id) do nothing;
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


-- Functional assertions only, against disposable PostgreSQL.
do $$ declare q jsonb; v_sale uuid; v_refund uuid; first_item uuid; second_item uuid; movements integer; begin

  q:=public.quote_sale('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','[{"product_id":"6aaaaaaa-2222-2222-2222-aaaaaaaaaaaa","quantity":4}]');
  v_sale:=public.complete_sale_with_customer('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','SALE-REVIEWED','[{"product_id":"6aaaaaaa-2222-2222-2222-aaaaaaaaaaaa","quantity":4}]','[{"method":"CASH","amount":4400}]','reviewed:one',null,null,q,5000);
  if (select currency_code from public.sales where id=v_sale)<>'CAD' then raise exception 'organization currency not used'; end if;
  if not exists(select 1 from public.payments where sale_id=v_sale and tendered_amount=5000 and change_amount=600 and amount=4400) then raise exception 'cash/change arithmetic wrong'; end if;
  select count(*) into movements from public.inventory_movements;
  if public.complete_sale_with_customer('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','SALE-REVIEWED','[{"product_id":"6aaaaaaa-2222-2222-2222-aaaaaaaaaaaa","quantity":4}]','[{"method":"CASH","amount":4400}]','reviewed:one',null,null,q,5000)<>v_sale then raise exception 'sale retry identity wrong'; end if;
  if (select count(*) from public.inventory_movements)<>movements or (select count(*) from public.payments where sale_id=v_sale)<>1 then raise exception 'retry duplicated state'; end if;
  select id into first_item from public.sale_items where sale_id=v_sale and batch_id='6aaaaaaa-3333-3333-3333-aaaaaaaaaaa1';
  select id into second_item from public.sale_items where sale_id=v_sale and batch_id='6aaaaaaa-3333-3333-3333-aaaaaaaaaaa2';
  v_refund:=public.refund_sale(v_sale,'REF-SECOND',jsonb_build_array(jsonb_build_object('sale_item_id',second_item,'quantity',0.5)),'refund:second','partial second lot');
  if not exists(select 1 from public.sale_refund_items where refund_id=v_refund and sale_item_id=second_item and quantity=0.5 and amount=600) then raise exception 'non-first refund incorrect'; end if;
  if exists(select 1 from public.sale_refund_items where refund_id=v_refund and sale_item_id=first_item) then raise exception 'wrong item refunded'; end if;
  perform public.refund_sale(v_sale,'REF-SECOND',jsonb_build_array(jsonb_build_object('sale_item_id',second_item,'quantity',0.5)),'refund:second','retry');
  if (select count(*) from public.sale_refund_items where refund_id=v_refund)<>1 then raise exception 'refund duplicated'; end if;
  perform public.refund_sale(v_sale,'REF-SECOND-2',jsonb_build_array(jsonb_build_object('sale_item_id',second_item,'quantity',1.5)),'refund:second:two','remaining second lot');
  begin
    perform public.refund_sale(v_sale,'REF-EXCESS',jsonb_build_array(jsonb_build_object('sale_item_id',second_item,'quantity',0.1)),'refund:excess','over refund');
    raise exception 'over-refund accepted';
  exception when check_violation then null; end;
  if (select count(*) from public.payments where sale_id=v_sale and amount=4400 and status='RECORDED')<>1 then raise exception 'refund changed original payment'; end if;
  if (select on_hand_quantity from public.inventory_balances where batch_id='6aaaaaaa-3333-3333-3333-aaaaaaaaaaa2')<>3 then raise exception 'refund balance wrong'; end if;
  q:=public.quote_sale('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','[{"product_id":"6aaaaaaa-2222-2222-2222-aaaaaaaaaaaa","quantity":1}]');
  -- Same total, wrong lot: the completed transaction must be rolled back.
  q:=jsonb_set(q,'{items,0,batch_id}','"6aaaaaaa-3333-3333-3333-aaaaaaaaaaa1"');
  select count(*) into movements from public.inventory_movements;
  begin
    perform public.complete_sale_with_customer('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','SALE-CHANGED','[{"product_id":"6aaaaaaa-2222-2222-2222-aaaaaaaaaaaa","quantity":1}]','[{"method":"CASH","amount":1200}]','reviewed:changed',null,null,q,1200);
    raise exception 'same total changed allocation accepted';
  exception when check_violation then if sqlerrm<>'SALE_QUOTE_CHANGED' then raise; end if; end;
  if exists(select 1 from public.sales where sale_number='SALE-CHANGED') or (select count(*) from public.inventory_movements)<>movements then raise exception 'changed quote leaked writes'; end if;
end $$;
reset role;
-- Blocked batches never enter quotes, regardless of positive physical quantity.
do $$ declare state text; q jsonb; begin
  foreach state in array array['QUARANTINED','RECALLED','EXPIRED','DISPOSED','DEPLETED'] loop
    update public.batches set status=state where organization_id='6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    begin
      q:=public.quote_sale('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','[{"product_id":"6aaaaaaa-2222-2222-2222-aaaaaaaaaaaa","quantity":1}]');
      raise exception 'blocked batch accepted: %',state;
    exception when check_violation then if sqlerrm<>'INSUFFICIENT_STOCK' then raise; end if; end;
  end loop;
end $$;
rollback;
