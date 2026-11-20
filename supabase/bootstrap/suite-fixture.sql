-- DML-only prerequisites for suites originally coupled to retained report fixtures.
-- Applied AFTER full bootstrap, in each suite's own disposable database.
-- No product schema, grants, policies or implementation functions are replaced.
begin;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('66000000-0000-0000-0000-000000000001','canonical-owner@example.invalid',now(),'{}'),
 ('66000000-0000-0000-0000-000000000002','canonical-cashier@example.invalid',now(),'{}');
select set_config('request.jwt.claim.sub','66000000-0000-0000-0000-000000000001',true);
insert into public.organizations(id,name,slug,currency_code,timezone) values
 ('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Canonical fixture','canonical-fixture','CAD','America/Toronto');
insert into public.branches(id,organization_id,name,code) values
 ('6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Main','MAIN'),
 ('6aaaaaaa-1111-1111-1111-aaaaaaaaaaa2','6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Second','SECOND');
insert into public.organization_memberships(id,organization_id,user_id,role_id,status) values
 ('6a100000-0000-0000-0000-000000000001','6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','66000000-0000-0000-0000-000000000001',(select id from public.roles where organization_id is null and code='OWNER'),'active'),
 ('6a100000-0000-0000-0000-000000000002','6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','66000000-0000-0000-0000-000000000002',(select id from public.roles where organization_id is null and code='CASHIER'),'active');
insert into public.branch_memberships(branch_id,organization_membership_id) values
 ('6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','6a100000-0000-0000-0000-000000000001'),
 ('6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','6a100000-0000-0000-0000-000000000002'),
 ('6aaaaaaa-1111-1111-1111-aaaaaaaaaaa2','6a100000-0000-0000-0000-000000000001');
insert into public.products(id,organization_id,name,stock_unit) values
 ('6aaaaaaa-2222-2222-2222-aaaaaaaaaaaa','6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Canonical product','tablet');
insert into public.batches(id,organization_id,branch_id,product_id,lot_number,expiry_date,purchase_cost,selling_price) values
 ('6aaaaaaa-3333-3333-3333-aaaaaaaaaaa1','6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','6aaaaaaa-2222-2222-2222-aaaaaaaaaaaa','CANONICAL',current_date+20,2,10);
insert into public.suppliers(organization_id,name) values('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Canonical supplier');
set local role authenticated;
select public.post_inventory_movement('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','6aaaaaaa-3333-3333-3333-aaaaaaaaaaa1','ADJUSTMENT_IN',100,'canonical:fixture','Fictional test stock');
commit;
