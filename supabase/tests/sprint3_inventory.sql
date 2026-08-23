-- Sprint 3 inventory ledger regression tests.
-- Run only against an isolated/local Supabase test database. Everything is rolled back.

begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values
('33000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','inventory-owner@test.invalid','',now(),now(),now(),'{}','{}')
on conflict (id) do nothing;

insert into public.organizations(id,name,slug,country_code,currency_code,timezone,default_locale)
values ('daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Inventory Pharmacy','inventory-pharmacy','CI','XOF','Africa/Abidjan','fr')
on conflict (id) do nothing;

insert into public.branches(id,organization_id,name,code,country_code,timezone)
values ('daaaaaaa-1111-1111-1111-aaaaaaaaaaaa','daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Main','MAIN','CI','Africa/Abidjan')
on conflict (id) do nothing;

insert into public.organization_memberships(id,organization_id,user_id,role_id,status)
values (
  'da100000-0000-0000-0000-000000000001','daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','33000000-0000-0000-0000-000000000001',
  (select id from public.roles where organization_id is null and code='OWNER'),'active'
)
on conflict (id) do nothing;

insert into public.branch_memberships(branch_id,organization_membership_id)
values ('daaaaaaa-1111-1111-1111-aaaaaaaaaaaa','da100000-0000-0000-0000-000000000001')
on conflict do nothing;

insert into public.products(id,organization_id,name,status)
values ('daaaaaaa-2222-2222-2222-aaaaaaaaaaaa','daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Inventory Test Product','active')
on conflict (id) do nothing;

insert into public.batches(id,organization_id,branch_id,product_id,lot_number,expiry_date,status)
values (
  'daaaaaaa-3333-3333-3333-aaaaaaaaaaaa','daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','daaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
  'daaaaaaa-2222-2222-2222-aaaaaaaaaaaa','LOT-001',current_date + 365,'ACTIVE'
)
on conflict (id) do nothing;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','33000000-0000-0000-0000-000000000001',true);

-- Initial receipt creates +100.
select public.post_inventory_movement(
  'daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','daaaaaaa-1111-1111-1111-aaaaaaaaaaaa','daaaaaaa-3333-3333-3333-aaaaaaaaaaaa',
  'PURCHASE_RECEIPT',100,'test:receipt:1','Opening test stock'
);

do $$
begin
  if (select on_hand_quantity from public.inventory_balances where batch_id='daaaaaaa-3333-3333-3333-aaaaaaaaaaaa') <> 100 then
    raise exception 'INV-T-001 failed: opening balance is not 100';
  end if;
end $$;

-- Same idempotency key returns the existing movement rather than duplicating stock.
select public.post_inventory_movement(
  'daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','daaaaaaa-1111-1111-1111-aaaaaaaaaaaa','daaaaaaa-3333-3333-3333-aaaaaaaaaaaa',
  'PURCHASE_RECEIPT',100,'test:receipt:1','Duplicate request'
);

do $$
begin
  if (select on_hand_quantity from public.inventory_balances where batch_id='daaaaaaa-3333-3333-3333-aaaaaaaaaaaa') <> 100 then
    raise exception 'INV-T-002 failed: idempotency duplicated stock';
  end if;
end $$;

-- Negative stock is rejected.
do $$
begin
  begin
    perform public.post_inventory_movement(
      'daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','daaaaaaa-1111-1111-1111-aaaaaaaaaaaa','daaaaaaa-3333-3333-3333-aaaaaaaaaaaa',
      'ADJUSTMENT_OUT',-101,'test:negative:1','Should fail'
    );
    raise exception 'INV-T-003 failed: negative stock was allowed';
  exception when check_violation then null;
  end;
end $$;

-- Ledger rows are immutable.
do $$
declare v_id uuid;
begin
  select id into v_id from public.inventory_movements where idempotency_key='test:receipt:1';
  begin
    update public.inventory_movements set reason='mutated' where id=v_id;
    raise exception 'INV-T-004 failed: ledger update was allowed';
  exception when object_not_in_prerequisite_state then null;
  end;
end $$;

-- Physical count 93 creates a compensating -7 movement and completes count.
do $$
declare v_count uuid;
begin
  insert into public.inventory_stock_counts(organization_id,branch_id)
  values ('daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','daaaaaaa-1111-1111-1111-aaaaaaaaaaaa') returning id into v_count;

  insert into public.inventory_stock_count_lines(stock_count_id,organization_id,branch_id,batch_id,counted_quantity)
  values (v_count,'daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','daaaaaaa-1111-1111-1111-aaaaaaaaaaaa','daaaaaaa-3333-3333-3333-aaaaaaaaaaaa',93);

  perform public.complete_inventory_stock_count(v_count);

  if (select on_hand_quantity from public.inventory_balances where batch_id='daaaaaaa-3333-3333-3333-aaaaaaaaaaaa') <> 93 then
    raise exception 'INV-T-005 failed: count reconciliation did not produce 93';
  end if;
  if (select status from public.inventory_stock_counts where id=v_count) <> 'COMPLETED' then
    raise exception 'INV-T-006 failed: stock count not completed';
  end if;
end $$;

reset role;
rollback;
