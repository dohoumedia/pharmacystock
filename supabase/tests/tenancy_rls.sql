-- Pharmacy Stock baseline tenancy RLS test harness.
-- Intended for an isolated/local Supabase database, never for production data.
-- Run after applying Sprint 1 migrations. The transaction is rolled back.

begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) values
(
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'tenant-a@test.invalid', '',
  now(), now(), now(), '{}'::jsonb, '{"preferred_locale":"en"}'::jsonb
),
(
  '20000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'tenant-b@test.invalid', '',
  now(), now(), now(), '{}'::jsonb, '{"preferred_locale":"fr"}'::jsonb
)
on conflict (id) do nothing;

insert into public.organizations (
  id, name, slug, country_code, currency_code, timezone, default_locale
) values
(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'RLS Pharmacy A', 'rls-pharmacy-a', 'CI', 'XOF', 'Africa/Abidjan', 'fr'
),
(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'RLS Pharmacy B', 'rls-pharmacy-b', 'SN', 'XOF', 'Africa/Dakar', 'fr'
)
on conflict (id) do nothing;

insert into public.branches (
  id, organization_id, name, code, country_code, timezone
) values
(
  'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Branch A1', 'A1', 'CI', 'Africa/Abidjan'
),
(
  'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'Branch B1', 'B1', 'SN', 'Africa/Dakar'
)
on conflict (id) do nothing;

insert into public.organization_memberships (
  id, organization_id, user_id, role_id, status
) values
(
  'a1000000-0000-0000-0000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '10000000-0000-0000-0000-000000000001',
  (select id from public.roles where organization_id is null and code='OWNER'),
  'active'
),
(
  'b2000000-0000-0000-0000-000000000002',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '20000000-0000-0000-0000-000000000002',
  (select id from public.roles where organization_id is null and code='OWNER'),
  'active'
)
on conflict (id) do nothing;

insert into public.branch_memberships (branch_id, organization_membership_id)
values
(
  'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
  'a1000000-0000-0000-0000-000000000001'
),
(
  'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb',
  'b2000000-0000-0000-0000-000000000002'
)
on conflict do nothing;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
begin
  if (select count(*) from public.organizations) <> 1 then
    raise exception 'RLS-T-001 failed: User A must see exactly one organization';
  end if;

  if exists (select 1 from public.organizations where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') then
    raise exception 'RLS-T-002 failed: User A can read Pharmacy B';
  end if;

  if not exists (select 1 from public.organizations where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') then
    raise exception 'RLS-T-003 failed: User A cannot read Pharmacy A';
  end if;

  if exists (select 1 from public.branches where id = 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb') then
    raise exception 'RLS-T-004 failed: User A can read Pharmacy B branch';
  end if;

  if app_private.is_org_member('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') then
    raise exception 'RLS-T-005 failed: is_org_member returns true for foreign tenant';
  end if;

  if not app_private.is_org_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') then
    raise exception 'RLS-T-006 failed: is_org_member false for own tenant';
  end if;

  if app_private.has_branch_access('bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb') then
    raise exception 'RLS-T-007 failed: branch access granted to foreign branch';
  end if;

  if not app_private.has_branch_access('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa') then
    raise exception 'RLS-T-008 failed: own branch access denied';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);

do $$
begin
  if exists (select 1 from public.organizations where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') then
    raise exception 'RLS-T-009 failed: User B can read Pharmacy A';
  end if;

  if not exists (select 1 from public.organizations where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') then
    raise exception 'RLS-T-010 failed: User B cannot read Pharmacy B';
  end if;
end;
$$;

reset role;
rollback;
