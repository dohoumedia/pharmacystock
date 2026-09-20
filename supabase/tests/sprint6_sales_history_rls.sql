-- Sales-history branch-isolation regression test. Run on isolated DB; rolled back.
begin;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
values('66100000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','sales-history@test.invalid','',now(),now(),now(),'{}','{}')
on conflict(id) do nothing;

insert into public.organizations(id,name,slug)
values('6baaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Sales History Test','sales-history-test')
on conflict(id) do nothing;

insert into public.branches(id,organization_id,name,code) values
('6baaaaaa-1111-1111-1111-aaaaaaaaaaaa','6baaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Allowed','ALLOWED'),
('6baaaaaa-2222-2222-2222-aaaaaaaaaaaa','6baaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Blocked','BLOCKED')
on conflict(id) do nothing;

insert into public.organization_memberships(id,organization_id,user_id,role_id,status)
values(
 '6b100000-0000-0000-0000-000000000001',
 '6baaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
 '66100000-0000-0000-0000-000000000001',
 (select id from public.roles where organization_id is null and code='CASHIER'),
 'active'
)
on conflict(id) do nothing;

insert into public.branch_memberships(branch_id,organization_membership_id)
values('6baaaaaa-1111-1111-1111-aaaaaaaaaaaa','6b100000-0000-0000-0000-000000000001')
on conflict do nothing;

insert into public.products(id,organization_id,name,status)
values('6baaaaaa-3333-3333-3333-aaaaaaaaaaaa','6baaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','RLS Product','active')
on conflict(id) do nothing;

insert into public.batches(id,organization_id,branch_id,product_id,lot_number,expiry_date,purchase_cost,selling_price,status) values
('6baaaaaa-4444-4444-4444-aaaaaaaaaaa1','6baaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','6baaaaaa-1111-1111-1111-aaaaaaaaaaaa','6baaaaaa-3333-3333-3333-aaaaaaaaaaaa','ALLOWED',current_date+30,1,2,'ACTIVE'),
('6baaaaaa-4444-4444-4444-aaaaaaaaaaa2','6baaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','6baaaaaa-2222-2222-2222-aaaaaaaaaaaa','6baaaaaa-3333-3333-3333-aaaaaaaaaaaa','BLOCKED',current_date+30,1,2,'ACTIVE')
on conflict(id) do nothing;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','66100000-0000-0000-0000-000000000001',true);

select public.post_inventory_movement('6baaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','6baaaaaa-1111-1111-1111-aaaaaaaaaaaa','6baaaaaa-4444-4444-4444-aaaaaaaaaaa1','PURCHASE_RECEIPT',1,'sales-history:allowed','seed');
reset role;

-- Seed blocked-branch history as database owner so the RLS read boundary can be tested independently.
insert into public.inventory_movements(
 organization_id,branch_id,batch_id,movement_type,quantity_delta,idempotency_key,reason,reference_type,reference_id,metadata,created_by
) values(
 '6baaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','6baaaaaa-2222-2222-2222-aaaaaaaaaaaa','6baaaaaa-4444-4444-4444-aaaaaaaaaaa2',
 'PURCHASE_RECEIPT',1,'sales-history:blocked','seed','QA','BLOCKED','{}','66100000-0000-0000-0000-000000000001'
) returning id;

insert into public.sales(id,organization_id,branch_id,sale_number,status,subtotal,total_amount,idempotency_key,created_by)
values('6baaaaaa-5555-5555-5555-aaaaaaaaaaaa','6baaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','6baaaaaa-2222-2222-2222-aaaaaaaaaaaa','BLOCKED-SALE','COMPLETED',2,2,'blocked-sale','66100000-0000-0000-0000-000000000001');

insert into public.sale_items(id,organization_id,sale_id,product_id,batch_id,quantity,unit_price,inventory_movement_id)
select
 '6baaaaaa-6666-6666-6666-aaaaaaaaaaaa',
 '6baaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
 '6baaaaaa-5555-5555-5555-aaaaaaaaaaaa',
 '6baaaaaa-3333-3333-3333-aaaaaaaaaaaa',
 '6baaaaaa-4444-4444-4444-aaaaaaaaaaa2',
 1,2,id
from public.inventory_movements
where idempotency_key='sales-history:blocked'
limit 1;

insert into public.sale_refunds(id,organization_id,branch_id,sale_id,refund_number,reason,amount,idempotency_key,created_by)
values(
 '6baaaaaa-7777-7777-7777-aaaaaaaaaaaa',
 '6baaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
 '6baaaaaa-2222-2222-2222-aaaaaaaaaaaa',
 '6baaaaaa-5555-5555-5555-aaaaaaaaaaaa',
 'BLOCKED-REFUND','qa',2,'blocked-refund','66100000-0000-0000-0000-000000000001'
);

insert into public.sale_refund_items(id,organization_id,refund_id,sale_item_id,batch_id,quantity,amount,inventory_movement_id)
select
 '6baaaaaa-8888-8888-8888-aaaaaaaaaaaa',
 '6baaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
 '6baaaaaa-7777-7777-7777-aaaaaaaaaaaa',
 '6baaaaaa-6666-6666-6666-aaaaaaaaaaaa',
 '6baaaaaa-4444-4444-4444-aaaaaaaaaaa2',
 1,2,id
from public.inventory_movements
where idempotency_key='sales-history:blocked'
limit 1;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','66100000-0000-0000-0000-000000000001',true);

do $$
begin
  if exists(select 1 from public.sales where id='6baaaaaa-5555-5555-5555-aaaaaaaaaaaa') then
    raise exception 'SALES-HISTORY-RLS-001 blocked branch sale leaked';
  end if;
  if exists(select 1 from public.sale_items where id='6baaaaaa-6666-6666-6666-aaaaaaaaaaaa') then
    raise exception 'SALES-HISTORY-RLS-002 blocked branch sale item leaked';
  end if;
  if exists(select 1 from public.sale_refunds where id='6baaaaaa-7777-7777-7777-aaaaaaaaaaaa') then
    raise exception 'SALES-HISTORY-RLS-003 blocked branch refund leaked';
  end if;
  if exists(select 1 from public.sale_refund_items where id='6baaaaaa-8888-8888-8888-aaaaaaaaaaaa') then
    raise exception 'SALES-HISTORY-RLS-004 blocked branch refund item leaked';
  end if;
end $$;

reset role;
rollback;
