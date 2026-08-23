-- Sprint 2 product catalogue / batch RLS regression tests.
-- Run only in an isolated/local database. Everything is rolled back.

begin;

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
('41000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','inventory-a@test.invalid','',now(),now(),now(),'{}','{}'),
('42000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','inventory-b@test.invalid','',now(),now(),now(),'{}','{}')
on conflict (id) do nothing;

insert into public.organizations(id,name,slug,country_code,currency_code,timezone,default_locale)
values
('daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Catalog Pharmacy A','catalog-pharmacy-a','CI','XOF','Africa/Abidjan','fr'),
('dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Catalog Pharmacy B','catalog-pharmacy-b','SN','XOF','Africa/Dakar','fr')
on conflict (id) do nothing;

insert into public.branches(id,organization_id,name,code,country_code,timezone)
values
('daaaaaaa-1111-1111-1111-aaaaaaaaaaaa','daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','A Main','MAIN','CI','Africa/Abidjan'),
('daaaaaaa-2222-2222-2222-aaaaaaaaaaaa','daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','A Other','OTHER','CI','Africa/Abidjan'),
('dbbbbbbb-1111-1111-1111-bbbbbbbbbbbb','dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','B Main','MAIN','SN','Africa/Dakar')
on conflict (id) do nothing;

insert into public.organization_memberships(id,organization_id,user_id,role_id,status)
values
('da100000-0000-0000-0000-000000000001','daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','41000000-0000-0000-0000-000000000001',(select id from public.roles where organization_id is null and code='INVENTORY_OFFICER'),'active'),
('db100000-0000-0000-0000-000000000001','dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','42000000-0000-0000-0000-000000000001',(select id from public.roles where organization_id is null and code='INVENTORY_OFFICER'),'active')
on conflict (id) do nothing;

insert into public.branch_memberships(branch_id, organization_membership_id)
values
('daaaaaaa-1111-1111-1111-aaaaaaaaaaaa','da100000-0000-0000-0000-000000000001'),
('dbbbbbbb-1111-1111-1111-bbbbbbbbbbbb','db100000-0000-0000-0000-000000000001')
on conflict do nothing;

insert into public.categories(id,organization_id,name)
values
('daaaaaaa-ca00-0000-0000-000000000001','daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Analgesics'),
('dbbbbbbb-ca00-0000-0000-000000000001','dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Antibiotics');

insert into public.manufacturers(id,organization_id,name)
values
('daaaaaaa-ma00-0000-0000-000000000001','daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Maker A'),
('dbbbbbbb-ma00-0000-0000-000000000001','dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Maker B');

insert into public.products(id,organization_id,name,category_id,manufacturer_id,sku)
values
('daaaaaaa-pr00-0000-0000-000000000001','daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Paracetamol 500 mg','daaaaaaa-ca00-0000-0000-000000000001','daaaaaaa-ma00-0000-0000-000000000001','PARA500'),
('dbbbbbbb-pr00-0000-0000-000000000001','dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Amoxicillin 500 mg','dbbbbbbb-ca00-0000-0000-000000000001','dbbbbbbb-ma00-0000-0000-000000000001','AMOX500');

insert into public.product_barcodes(organization_id,product_id,barcode,is_primary)
values
('daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','daaaaaaa-pr00-0000-0000-000000000001','1111111111111',true),
('dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','dbbbbbbb-pr00-0000-0000-000000000001','2222222222222',true);

insert into public.batches(id,organization_id,branch_id,product_id,lot_number,expiry_date)
values
('daaaaaaa-ba00-0000-0000-000000000001','daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','daaaaaaa-1111-1111-1111-aaaaaaaaaaaa','daaaaaaa-pr00-0000-0000-000000000001','LOT-A','2027-12-31'),
('dbbbbbbb-ba00-0000-0000-000000000001','dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','dbbbbbbb-1111-1111-1111-bbbbbbbbbbbb','dbbbbbbb-pr00-0000-0000-000000000001','LOT-B','2027-12-31');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','41000000-0000-0000-0000-000000000001',true);

do $$
begin
  if (select count(*) from public.products) <> 1 then
    raise exception 'CAT-T-001 failed: inventory user must see exactly own-tenant product';
  end if;
  if exists(select 1 from public.products where organization_id='dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') then
    raise exception 'CAT-T-002 failed: foreign product visible';
  end if;
  if exists(select 1 from public.product_barcodes where barcode='2222222222222') then
    raise exception 'CAT-T-003 failed: foreign barcode visible';
  end if;
  if (select count(*) from public.batches) <> 1 then
    raise exception 'CAT-T-004 failed: batch branch/tenant scope incorrect';
  end if;
end $$;

-- Atomic RPC creates the product and primary barcode under caller RLS.
select public.create_product_with_barcode(
  'daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Ibuprofen 400 mg', 'Ibuprofen', null, '400 mg', 'Tablet', '20 tablets', 'IBU400',
  'daaaaaaa-ca00-0000-0000-000000000001', 'daaaaaaa-ma00-0000-0000-000000000001', '3333333333333'
);

do $$
begin
  if not exists(select 1 from public.product_barcodes where barcode='3333333333333') then
    raise exception 'CAT-T-005 failed: atomic product/barcode creation failed';
  end if;
end $$;

-- Cross-tenant classification cannot be attached because composite FK/RLS protects the boundary.
do $$
begin
  begin
    insert into public.products(organization_id,name,category_id)
    values ('daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Bad Product','dbbbbbbb-ca00-0000-0000-000000000001');
    raise exception 'CAT-T-006 failed: foreign category attached to product';
  exception
    when foreign_key_violation then null;
    when insufficient_privilege then null;
    when check_violation then null;
  end;
end $$;

-- Inventory officer may create a batch only in an assigned branch.
insert into public.batches(organization_id,branch_id,product_id,lot_number,expiry_date)
select 'daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','daaaaaaa-1111-1111-1111-aaaaaaaaaaaa',id,'LOT-ASSIGNED','2028-01-01'
from public.products where sku='IBU400';

do $$
begin
  begin
    insert into public.batches(organization_id,branch_id,product_id,lot_number,expiry_date)
    select 'daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','daaaaaaa-2222-2222-2222-aaaaaaaaaaaa',id,'LOT-UNASSIGNED','2028-01-01'
    from public.products where sku='IBU400';
    raise exception 'CAT-T-007 failed: batch created in unassigned branch';
  exception
    when insufficient_privilege then null;
    when check_violation then null;
  end;
end $$;

-- Product hard delete is unavailable to ordinary authenticated clients.
do $$
begin
  begin
    delete from public.products where id='daaaaaaa-pr00-0000-0000-000000000001';
    raise exception 'CAT-T-008 failed: product hard delete allowed';
  exception
    when insufficient_privilege then null;
  end;
end $$;

reset role;
rollback;
