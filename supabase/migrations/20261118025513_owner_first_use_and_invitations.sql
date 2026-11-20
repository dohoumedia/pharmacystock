-- PRD-005/009; ORG-FR-001..004. Local implementation only; deployment is separate.
-- Reuse organizations/branches/memberships. No inventory or transaction changes.
create table public.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  branch_id uuid not null references public.branches(id),
  email text not null check (email = lower(btrim(email)) and length(email) <= 254),
  display_name text not null check (length(btrim(display_name)) between 1 and 160),
  role_id uuid not null references public.roles(id),
  invited_by uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending','accepted','cancelled')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index staff_invitations_pending_email on public.staff_invitations(organization_id, email) where status = 'pending';
create index staff_invitations_inbox on public.staff_invitations(email, status);
alter table public.staff_invitations enable row level security;
create policy staff_invitations_manager_read on public.staff_invitations for select to authenticated
  using (app_private.has_permission(organization_id, 'staff.manage'));
revoke all on public.staff_invitations from public, anon, authenticated;
grant select on public.staff_invitations to authenticated;

-- Privileged implementations live in the existing private schema. Each checks
-- authenticated identity and domain permissions; wrappers are SECURITY INVOKER.
create function app_private.complete_owner_setup(p_name text, p_branch_name text, p_country_code text, p_currency_code text, p_timezone text, p_locale text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); org_id uuid; branch_value uuid; member_id uuid; owner_role uuid;
begin
  if actor is null then raise exception 'AUTH_FORBIDDEN'; end if;
  if not exists (select 1 from auth.users where id = actor and email_confirmed_at is not null) then raise exception 'EMAIL_VERIFICATION_REQUIRED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('owner_setup:' || actor::text, 0));
  -- A retry after an uncertain response returns the existing first owner context.
  select m.organization_id into org_id from public.organization_memberships m
    join public.roles r on r.id = m.role_id join public.organizations o on o.id = m.organization_id
    where m.user_id = actor and m.status = 'active' and r.code = 'OWNER' and o.status = 'active'
    order by m.created_at limit 1;
  if org_id is not null then
    select id into branch_value from public.branches where organization_id = org_id and status = 'active' order by created_at limit 1;
    if branch_value is not null then return pg_catalog.jsonb_build_object('organization_id',org_id,'branch_id',branch_value); end if;
  end if;
  if exists (select 1 from public.organization_memberships where user_id = actor) then raise exception 'SETUP_ALREADY_MEMBER'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 160 or p_branch_name is null or length(btrim(p_branch_name)) not between 1 and 160
    or p_currency_code is null or p_currency_code !~ '^[A-Z]{3}$' or p_locale is null or p_locale not in ('en','fr')
    or (p_country_code is not null and p_country_code !~ '^[A-Z]{2}$')
    or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone)
    then raise exception 'SETUP_INVALID'; end if;
  select id into strict owner_role from public.roles where organization_id is null and code = 'OWNER';
  org_id := gen_random_uuid();
  insert into public.organizations(id,name,slug,country_code,currency_code,timezone,default_locale)
    values(org_id,btrim(p_name),'pharmacy-' || org_id::text,p_country_code,p_currency_code,p_timezone,p_locale);
  insert into public.branches(organization_id,name,code,country_code,timezone)
    values(org_id,btrim(p_branch_name),'MAIN',p_country_code,p_timezone) returning id into branch_value;
  insert into public.organization_memberships(organization_id,user_id,role_id)
    values(org_id,actor,owner_role) returning id into member_id;
  insert into public.branch_memberships(branch_id,organization_membership_id) values(branch_value,member_id);
  insert into public.audit_logs(organization_id,branch_id,actor_user_id,event_type,entity_type,entity_id)
    values(org_id,branch_value,actor,'organization.setup_completed','organizations',org_id::text);
  return pg_catalog.jsonb_build_object('organization_id',org_id,'branch_id',branch_value);
end;
$$;

create function app_private.invite_staff(p_organization_id uuid, p_email text, p_display_name text, p_role_id uuid, p_branch_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); email_value text := lower(btrim(p_email)); existing public.staff_invitations; result uuid;
begin
  if actor is null or not app_private.has_permission(p_organization_id,'staff.manage')
    or not exists (select 1 from public.organizations where id = p_organization_id and status = 'active') then raise exception 'AUTH_FORBIDDEN'; end if;
  if email_value is null or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(email_value) > 254
    or p_display_name is null or length(btrim(p_display_name)) not between 1 and 160
    or not exists (select 1 from public.roles where id = p_role_id and code <> 'OWNER' and (organization_id is null or organization_id = p_organization_id))
    or not exists (select 1 from public.branches where id = p_branch_id and organization_id = p_organization_id and status = 'active')
    then raise exception 'INVITATION_INVALID'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text || ':' || email_value, 0));
  if exists (select 1 from public.organization_memberships m join auth.users u on u.id = m.user_id
    where m.organization_id = p_organization_id and lower(u.email) = email_value) then raise exception 'INVITATION_ALREADY_MEMBER'; end if;
  select * into existing from public.staff_invitations where organization_id = p_organization_id and email = email_value and status = 'pending' for update;
  if existing.id is not null and existing.expires_at > now() then
    if existing.role_id = p_role_id and existing.branch_id = p_branch_id and existing.display_name = btrim(p_display_name) then return existing.id; end if;
    raise exception 'INVITATION_PENDING';
  end if;
  if existing.id is not null then update public.staff_invitations set status = 'cancelled' where id = existing.id; end if;
  insert into public.staff_invitations(organization_id,branch_id,email,display_name,role_id,invited_by)
    values(p_organization_id,p_branch_id,email_value,btrim(p_display_name),p_role_id,actor) returning id into result;
  insert into public.audit_logs(organization_id,branch_id,actor_user_id,event_type,entity_type,entity_id)
    values(p_organization_id,p_branch_id,actor,'staff.invitation_created','staff_invitations',result::text);
  return result;
end;
$$;

create function app_private.my_staff_invitations()
returns table(id uuid, organization_name text, branch_name text, role_name_en text, role_name_fr text, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.id,o.name,b.name,r.name_en,r.name_fr,i.expires_at from public.staff_invitations i
  join auth.users u on u.id = auth.uid() and u.email_confirmed_at is not null and lower(u.email) = i.email
  join public.organizations o on o.id = i.organization_id and o.status = 'active'
  join public.branches b on b.id = i.branch_id and b.organization_id = i.organization_id and b.status = 'active'
  join public.roles r on r.id = i.role_id
  where i.status = 'pending' and i.expires_at > now() order by i.created_at;
$$;

create function app_private.accept_staff_invitation(p_invitation_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); email_value text; invitation public.staff_invitations; member_id uuid;
begin
  select lower(email) into email_value from auth.users where id = actor and email_confirmed_at is not null;
  if actor is null or email_value is null then raise exception 'EMAIL_VERIFICATION_REQUIRED'; end if;
  select * into invitation from public.staff_invitations where id = p_invitation_id and email = email_value for update;
  if invitation.id is null then raise exception 'INVITATION_UNAVAILABLE'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('membership:' || invitation.organization_id::text || ':' || actor::text, 0));
  if invitation.status = 'accepted' and invitation.accepted_by = actor and exists (
    select 1 from public.organization_memberships m join public.organizations o on o.id = m.organization_id
    where m.organization_id = invitation.organization_id and m.user_id = actor and m.status = 'active' and o.status = 'active'
  ) then return invitation.organization_id; end if;
  if invitation.status <> 'pending' or invitation.expires_at <= now()
    or not exists (select 1 from public.organizations where id = invitation.organization_id and status = 'active')
    or not exists (select 1 from public.branches where id = invitation.branch_id and organization_id = invitation.organization_id and status = 'active')
    or not exists (select 1 from public.organization_memberships m join public.role_permissions rp on rp.role_id = m.role_id
      where m.organization_id = invitation.organization_id and m.user_id = invitation.invited_by and m.status = 'active' and rp.permission_code = 'staff.manage')
    or not exists (select 1 from public.roles where id = invitation.role_id and code <> 'OWNER' and (organization_id is null or organization_id = invitation.organization_id))
    then raise exception 'INVITATION_UNAVAILABLE'; end if;
  if exists (select 1 from public.organization_memberships where organization_id = invitation.organization_id and user_id = actor) then raise exception 'INVITATION_ALREADY_MEMBER'; end if;
  insert into public.organization_memberships(organization_id,user_id,role_id,status)
    values(invitation.organization_id,actor,invitation.role_id,'active') returning id into member_id;
  insert into public.branch_memberships(branch_id,organization_membership_id) values(invitation.branch_id,member_id);
  update public.profiles set display_name = invitation.display_name where user_id = actor and (display_name is null or lower(display_name) = email_value);
  update public.staff_invitations set status = 'accepted',accepted_by = actor,accepted_at = now() where id = invitation.id;
  insert into public.audit_logs(organization_id,branch_id,actor_user_id,event_type,entity_type,entity_id)
    values(invitation.organization_id,invitation.branch_id,actor,'staff.invitation_accepted','staff_invitations',invitation.id::text);
  return invitation.organization_id;
end;
$$;

create function app_private.cancel_staff_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare invitation public.staff_invitations;
begin
  select * into invitation from public.staff_invitations where id = p_invitation_id for update;
  if auth.uid() is null or invitation.id is null or not app_private.has_permission(invitation.organization_id,'staff.manage') then raise exception 'AUTH_FORBIDDEN'; end if;
  if invitation.status <> 'pending' then return; end if;
  update public.staff_invitations set status = 'cancelled' where id = invitation.id;
  insert into public.audit_logs(organization_id,branch_id,actor_user_id,event_type,entity_type,entity_id)
    values(invitation.organization_id,invitation.branch_id,auth.uid(),'staff.invitation_cancelled','staff_invitations',invitation.id::text);
end;
$$;

create function app_private.owner_setup_progress(p_organization_id uuid, p_branch_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or app_private.current_role_code(p_organization_id) <> 'OWNER' or not app_private.is_org_member(p_organization_id)
    or not exists (select 1 from public.organizations where id = p_organization_id and status = 'active')
    or not exists (select 1 from public.branches where id = p_branch_id and organization_id = p_organization_id and status = 'active') then raise exception 'AUTH_FORBIDDEN'; end if;
  return pg_catalog.jsonb_build_object('pharmacy',true,'branch',true,
    'staff',exists(select 1 from public.organization_memberships where organization_id = p_organization_id and user_id <> auth.uid() and status = 'active')
      or exists(select 1 from public.staff_invitations where organization_id = p_organization_id and status = 'pending' and expires_at > now()),
    'supplier',exists(select 1 from public.suppliers where organization_id = p_organization_id and status = 'active'),
    'product',exists(select 1 from public.products where organization_id = p_organization_id and status = 'active'),
    'purchase',exists(select 1 from public.purchase_orders where organization_id = p_organization_id and branch_id = p_branch_id and status <> 'cancelled'));
end;
$$;

-- Branch creation must also establish the creator's existing branch context.
-- The form retains p_branch_id on retry; no second branch is created.
create function app_private.create_branch_with_access(p_branch_id uuid, p_organization_id uuid, p_name text, p_code text, p_city text, p_phone text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare member_id uuid; organization public.organizations; existing public.branches;
begin
  if auth.uid() is null or not app_private.has_permission(p_organization_id,'branch.manage') then raise exception 'AUTH_FORBIDDEN'; end if;
  select * into organization from public.organizations where id = p_organization_id and status = 'active';
  select id into member_id from public.organization_memberships where organization_id = p_organization_id and user_id = auth.uid() and status = 'active';
  if organization.id is null or member_id is null then raise exception 'AUTH_FORBIDDEN'; end if;
  if p_branch_id is null or p_name is null or length(btrim(p_name)) not between 1 and 160 then raise exception 'SETUP_INVALID'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('branch_setup:' || p_branch_id::text,0));
  select * into existing from public.branches where id = p_branch_id;
  if existing.id is not null then
    if existing.organization_id <> p_organization_id or existing.name <> btrim(p_name) or existing.code is distinct from p_code
      or existing.city is distinct from p_city or existing.phone is distinct from p_phone then raise exception 'BRANCH_REQUEST_CHANGED'; end if;
    return existing.id;
  end if;
  insert into public.branches(id,organization_id,name,code,city,phone,country_code,timezone)
    values(p_branch_id,p_organization_id,btrim(p_name),p_code,p_city,p_phone,organization.country_code,organization.timezone);
  insert into public.branch_memberships(branch_id,organization_membership_id) values(p_branch_id,member_id);
  return p_branch_id;
end;
$$;
create function public.create_branch_with_access(p_branch_id uuid, p_organization_id uuid, p_name text, p_code text, p_city text, p_phone text)
returns uuid language sql security invoker set search_path = '' as $$ select app_private.create_branch_with_access(p_branch_id,p_organization_id,p_name,p_code,p_city,p_phone); $$;
revoke all on function app_private.create_branch_with_access(uuid,uuid,text,text,text,text), public.create_branch_with_access(uuid,uuid,text,text,text,text) from public, anon;
grant execute on function app_private.create_branch_with_access(uuid,uuid,text,text,text,text), public.create_branch_with_access(uuid,uuid,text,text,text,text) to authenticated;

create function public.complete_owner_setup(p_name text, p_branch_name text, p_country_code text, p_currency_code text, p_timezone text, p_locale text)
returns jsonb language sql security invoker set search_path = '' as $$ select app_private.complete_owner_setup(p_name,p_branch_name,p_country_code,p_currency_code,p_timezone,p_locale); $$;
create function public.invite_staff(p_organization_id uuid, p_email text, p_display_name text, p_role_id uuid, p_branch_id uuid)
returns uuid language sql security invoker set search_path = '' as $$ select app_private.invite_staff(p_organization_id,p_email,p_display_name,p_role_id,p_branch_id); $$;
create function public.my_staff_invitations()
returns table(id uuid, organization_name text, branch_name text, role_name_en text, role_name_fr text, expires_at timestamptz)
language sql stable security invoker set search_path = '' as $$ select * from app_private.my_staff_invitations(); $$;
create function public.accept_staff_invitation(p_invitation_id uuid)
returns uuid language sql security invoker set search_path = '' as $$ select app_private.accept_staff_invitation(p_invitation_id); $$;
create function public.cancel_staff_invitation(p_invitation_id uuid)
returns void language sql security invoker set search_path = '' as $$ select app_private.cancel_staff_invitation(p_invitation_id); $$;
create function public.owner_setup_progress(p_organization_id uuid, p_branch_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$ select app_private.owner_setup_progress(p_organization_id,p_branch_id); $$;

revoke all on function app_private.complete_owner_setup(text,text,text,text,text,text), public.complete_owner_setup(text,text,text,text,text,text),
  app_private.invite_staff(uuid,text,text,uuid,uuid), public.invite_staff(uuid,text,text,uuid,uuid),
  app_private.my_staff_invitations(), public.my_staff_invitations(),
  app_private.accept_staff_invitation(uuid), public.accept_staff_invitation(uuid),
  app_private.cancel_staff_invitation(uuid), public.cancel_staff_invitation(uuid),
  app_private.owner_setup_progress(uuid,uuid), public.owner_setup_progress(uuid,uuid) from public, anon;
grant execute on function app_private.complete_owner_setup(text,text,text,text,text,text), public.complete_owner_setup(text,text,text,text,text,text),
  app_private.invite_staff(uuid,text,text,uuid,uuid), public.invite_staff(uuid,text,text,uuid,uuid),
  app_private.my_staff_invitations(), public.my_staff_invitations(),
  app_private.accept_staff_invitation(uuid), public.accept_staff_invitation(uuid),
  app_private.cancel_staff_invitation(uuid), public.cancel_staff_invitation(uuid),
  app_private.owner_setup_progress(uuid,uuid), public.owner_setup_progress(uuid,uuid) to authenticated;
