-- Ordinary functional workflow. Run only against the disposable fixture database
-- prepared by scripts/test-owner-setup.ps1, never a hosted Supabase project.
begin;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000001','owner@example.test',now(),'{}'),
  ('10000000-0000-0000-0000-000000000002','staff@example.test',now(),'{}');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$
declare result jsonb; retried jsonb; org_id uuid; main_id uuid; invite_id uuid; second_id uuid;
begin
  result := public.complete_owner_setup('Pharmacie Centre','Centre','BJ','XOF','UTC','fr');
  org_id := (result->>'organization_id')::uuid; main_id := (result->>'branch_id')::uuid;
  if not exists(select 1 from public.organizations where id = org_id and name = 'Pharmacie Centre' and default_locale = 'fr') then raise exception 'FAIL pharmacy creation'; end if;
  if not exists(select 1 from public.branches where id = main_id and organization_id = org_id and status = 'active') then raise exception 'FAIL first branch creation'; end if;
  if not exists(select 1 from public.organization_memberships where organization_id = org_id and user_id = auth.uid() and status = 'active') then raise exception 'FAIL owner membership'; end if;
  if not exists(select 1 from public.branch_memberships where branch_id = main_id) then raise exception 'FAIL first branch membership'; end if;
  retried := public.complete_owner_setup('Pharmacie Centre','Centre','BJ','XOF','UTC','fr');
  if result <> retried or (select count(*) from public.organizations) <> 1 then raise exception 'FAIL setup retry duplicated records'; end if;
  if public.owner_setup_progress(org_id,main_id) <> '{"pharmacy":true,"branch":true,"staff":false,"supplier":false,"product":false,"purchase":false}'::jsonb then raise exception 'FAIL initial checklist'; end if;
  second_id := public.create_branch_with_access('20000000-0000-0000-0000-000000000001',org_id,'Nord','NORD',null,null);
  if second_id <> public.create_branch_with_access('20000000-0000-0000-0000-000000000001',org_id,'Nord','NORD',null,null) then raise exception 'FAIL branch retry'; end if;
  if not app_private.has_branch_access(second_id) then raise exception 'FAIL created branch is not usable by owner'; end if;
  if (select count(*) from public.branches where organization_id = org_id and status = 'active') <> 2 then raise exception 'FAIL additional branch'; end if;
  invite_id := public.invite_staff(org_id,' STAFF@example.test ','Marie',(select id from public.roles where code = 'CASHIER' and organization_id is null),main_id);
  if invite_id <> public.invite_staff(org_id,'staff@example.test','Marie',(select id from public.roles where code = 'CASHIER' and organization_id is null),main_id) then raise exception 'FAIL invitation retry'; end if;
  if not (public.owner_setup_progress(org_id,main_id)->>'staff')::boolean then raise exception 'FAIL invitation checklist'; end if;
  if (select status from public.staff_invitations where id = invite_id) <> 'pending' then raise exception 'FAIL pending invitation'; end if;
  perform set_config('test.org_id',org_id::text,true);
  perform set_config('test.branch_id',main_id::text,true);
  perform set_config('test.invite_id',invite_id::text,true);
  raise notice 'PASS pharmacy + initial branch + owner context + retry + branch creation + pending invitation';
end $$;
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
set local role authenticated;
do $$
declare invite_id uuid := current_setting('test.invite_id')::uuid; org_id uuid := current_setting('test.org_id')::uuid;
begin
  if (select count(*) from public.my_staff_invitations()) <> 1 then raise exception 'FAIL incoming invitation'; end if;
  if public.accept_staff_invitation(invite_id) <> org_id then raise exception 'FAIL accept organization'; end if;
  if public.accept_staff_invitation(invite_id) <> org_id then raise exception 'FAIL acceptance retry'; end if;
  if exists(select 1 from public.my_staff_invitations()) then raise exception 'FAIL accepted invitation still pending'; end if;
  if not exists(select 1 from public.organization_memberships where organization_id = org_id and user_id = auth.uid() and status = 'active') then raise exception 'FAIL staff membership'; end if;
  if not exists(select 1 from public.branch_memberships where branch_id = current_setting('test.branch_id')::uuid) then raise exception 'FAIL staff branch'; end if;
  raise notice 'PASS verified-email inbox + acceptance + membership + branch + retry';
end $$;
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$
begin
  if not exists(select 1 from public.organization_memberships where user_id = '10000000-0000-0000-0000-000000000002' and status = 'active') then raise exception 'FAIL accepted staff visible'; end if;
  if (select status from public.staff_invitations where id = current_setting('test.invite_id')::uuid) <> 'accepted' then raise exception 'FAIL accepted status'; end if;
end $$;
reset role;
-- Prepare real supported catalog and purchasing state for the progress checklist.
set local role authenticated;
do $$
declare org uuid:=current_setting('test.org_id')::uuid; supplier uuid; product uuid;
begin
 insert into public.suppliers(organization_id,name,status) values(org,'Checklist supplier','active') returning id into supplier;
 product:=public.create_catalog_product(org,'{"name":"Checklist product","stock_unit":"unit"}');
 perform public.create_purchase_order(org,current_setting('test.branch_id')::uuid,supplier,'CHECKLIST-PO',null,null,
   jsonb_build_array(jsonb_build_object('product_id',product,'quantity',1,'unit_cost',2)),'checklist-po');
end $$;
do $$
begin
  if public.owner_setup_progress(current_setting('test.org_id')::uuid,current_setting('test.branch_id')::uuid) <> '{"pharmacy":true,"branch":true,"staff":true,"supplier":true,"product":true,"purchase":true}'::jsonb then raise exception 'FAIL final checklist'; end if;
  raise notice 'PASS accepted staff visible + saved supplier/product/PO checklist complete';
end $$;
rollback;
