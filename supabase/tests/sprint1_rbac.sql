-- Sprint 1 RBAC/security regression tests.
-- Run only against an isolated/local test database. Everything is rolled back.

begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values
('31000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-a@test.invalid','',now(),now(),now(),'{}','{}'),
('31000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','manager-a@test.invalid','',now(),now(),now(),'{}','{}'),
('31000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staff-a@test.invalid','',now(),now(),now(),'{}','{}'),
('32000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','outsider-b@test.invalid','',now(),now(),now(),'{}','{}')
on conflict (id) do nothing;

insert into public.organizations(id,name,slug,country_code,currency_code,timezone,default_locale)
values
('caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','RBAC Pharmacy A','rbac-pharmacy-a','CI','XOF','Africa/Abidjan','fr'),
('cbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','RBAC Pharmacy B','rbac-pharmacy-b','SN','XOF','Africa/Dakar','fr')
on conflict (id) do nothing;

insert into public.branches(id,organization_id,name,code,country_code,timezone)
values
('caaaaaaa-1111-1111-1111-aaaaaaaaaaaa','caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','A Main','MAIN','CI','Africa/Abidjan'),
('cbbbbbbb-1111-1111-1111-bbbbbbbbbbbb','cbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','B Main','MAIN','SN','Africa/Dakar')
on conflict (id) do nothing;

insert into public.organization_memberships(id,organization_id,user_id,role_id,status)
values
('ca100000-0000-0000-0000-000000000001','caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','31000000-0000-0000-0000-000000000001',(select id from public.roles where organization_id is null and code='OWNER'),'active'),
('ca100000-0000-0000-0000-000000000002','caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','31000000-0000-0000-0000-000000000002',(select id from public.roles where organization_id is null and code='MANAGER'),'active'),
('ca100000-0000-0000-0000-000000000003','caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','31000000-0000-0000-0000-000000000003',(select id from public.roles where organization_id is null and code='CASHIER'),'active'),
('cb100000-0000-0000-0000-000000000001','cbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','32000000-0000-0000-0000-000000000001',(select id from public.roles where organization_id is null and code='OWNER'),'active')
on conflict (id) do nothing;

insert into public.branch_memberships(branch_id, organization_membership_id)
values
('caaaaaaa-1111-1111-1111-aaaaaaaaaaaa','ca100000-0000-0000-0000-000000000001'),
('caaaaaaa-1111-1111-1111-aaaaaaaaaaaa','ca100000-0000-0000-0000-000000000002'),
('caaaaaaa-1111-1111-1111-aaaaaaaaaaaa','ca100000-0000-0000-0000-000000000003'),
('cbbbbbbb-1111-1111-1111-bbbbbbbbbbbb','cb100000-0000-0000-0000-000000000001')
on conflict do nothing;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','31000000-0000-0000-0000-000000000002',true);

-- Manager has staff.manage in own tenant but never in another tenant.
do $$
begin
  if not app_private.has_permission('caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','staff.manage') then
    raise exception 'RBAC-T-001 failed: manager lacks staff.manage';
  end if;
  if app_private.has_permission('cbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','staff.manage') then
    raise exception 'RBAC-T-002 failed: cross-tenant permission leak';
  end if;
end $$;

-- A manager may change another non-owner staff member to an assignable role.
update public.organization_memberships
set role_id = (select id from public.roles where organization_id is null and code='PHARMACIST')
where id = 'ca100000-0000-0000-0000-000000000003';

do $$
begin
  if (select r.code from public.organization_memberships m join public.roles r on r.id=m.role_id where m.id='ca100000-0000-0000-0000-000000000003') <> 'PHARMACIST' then
    raise exception 'RBAC-T-003 failed: authorized role change did not apply';
  end if;
end $$;

-- A manager may not promote another user to OWNER.
do $$
begin
  begin
    update public.organization_memberships
    set role_id = (select id from public.roles where organization_id is null and code='OWNER')
    where id = 'ca100000-0000-0000-0000-000000000003';
    raise exception 'RBAC-T-004 failed: manager promoted staff to OWNER';
  exception
    when insufficient_privilege then null;
    when check_violation then null;
  end;
end $$;

-- A user with staff.manage may not change their own membership/role through this policy.
do $$
declare affected integer;
begin
  update public.organization_memberships
  set status = 'suspended'
  where id = 'ca100000-0000-0000-0000-000000000002';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'RBAC-T-005 failed: manager changed own membership';
  end if;
end $$;

-- Outsider cannot see Pharmacy A.
select set_config('request.jwt.claim.sub','32000000-0000-0000-0000-000000000001',true);
do $$
begin
  if exists(select 1 from public.organizations where id='caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') then
    raise exception 'RBAC-T-006 failed: outsider can read foreign organization';
  end if;
end $$;

-- Owner suspends staff; suspended staff immediately loses org membership access.
select set_config('request.jwt.claim.sub','31000000-0000-0000-0000-000000000001',true);
update public.organization_memberships set status='suspended'
where id='ca100000-0000-0000-0000-000000000003';

select set_config('request.jwt.claim.sub','31000000-0000-0000-0000-000000000003',true);
do $$
begin
  if app_private.is_org_member('caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') then
    raise exception 'RBAC-T-007 failed: suspended member still has org access';
  end if;
  if exists(select 1 from public.organizations where id='caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') then
    raise exception 'RBAC-T-008 failed: suspended member can still read organization';
  end if;
end $$;

reset role;
rollback;
