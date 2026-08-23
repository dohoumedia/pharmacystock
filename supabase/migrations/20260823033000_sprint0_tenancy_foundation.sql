create extension if not exists pgcrypto;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active','suspended','cancelled')),
  country_code text,
  currency_code text not null default 'XOF',
  timezone text not null default 'UTC',
  default_locale text not null default 'fr' check (default_locale in ('fr','en')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  code text,
  status text not null default 'active' check (status in ('active','inactive')),
  address_line1 text,
  address_line2 text,
  city text,
  country_code text,
  phone text,
  email text,
  timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  preferred_locale text not null default 'fr' check (preferred_locale in ('fr','en')),
  phone text,
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  code text not null,
  name_en text not null,
  name_fr text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.permissions (
  code text primary key,
  description_en text not null,
  description_fr text not null,
  created_at timestamptz not null default now()
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_code)
);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid references public.roles(id) on delete set null,
  status text not null default 'active' check (status in ('invited','active','suspended','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table public.branch_memberships (
  branch_id uuid not null references public.branches(id) on delete cascade,
  organization_membership_id uuid not null references public.organization_memberships(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (branch_id, organization_membership_id)
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete restrict,
  branch_id uuid references public.branches(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  entity_type text,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_set_updated_at before update on public.organizations for each row execute function public.set_updated_at();
create trigger branches_set_updated_at before update on public.branches for each row execute function public.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger organization_memberships_set_updated_at before update on public.organization_memberships for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(user_id, display_name, preferred_locale)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email), coalesce(nullif(new.raw_user_meta_data->>'preferred_locale',''), 'fr'))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();

create or replace function public.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.organization_memberships m where m.organization_id = target_org and m.user_id = auth.uid() and m.status = 'active');
$$;

create or replace function public.has_branch_access(target_branch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.branch_memberships bm
    join public.organization_memberships m on m.id = bm.organization_membership_id
    where bm.branch_id = target_branch and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

create or replace function public.has_permission(target_org uuid, permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_memberships m
    join public.roles r on r.id = m.role_id
    join public.role_permissions rp on rp.role_id = r.id
    where m.organization_id = target_org and m.user_id = auth.uid() and m.status = 'active' and rp.permission_code = permission
  );
$$;

alter table public.organizations enable row level security;
alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.branch_memberships enable row level security;
alter table public.audit_logs enable row level security;

create policy organizations_select_member on public.organizations for select to authenticated using (public.is_org_member(id));
create policy branches_select_member on public.branches for select to authenticated using (public.is_org_member(organization_id));
create policy profiles_select_self on public.profiles for select to authenticated using (user_id = auth.uid());
create policy profiles_update_self on public.profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy roles_select_member on public.roles for select to authenticated using (organization_id is null or public.is_org_member(organization_id));
create policy permissions_select_authenticated on public.permissions for select to authenticated using (true);
create policy role_permissions_select_member on public.role_permissions for select to authenticated using (
  exists (select 1 from public.roles r where r.id = role_id and (r.organization_id is null or public.is_org_member(r.organization_id)))
);
create policy memberships_select_same_org on public.organization_memberships for select to authenticated using (public.is_org_member(organization_id));
create policy branch_memberships_select_member on public.branch_memberships for select to authenticated using (
  exists (select 1 from public.branches b where b.id = branch_id and public.is_org_member(b.organization_id))
);
create policy audit_logs_select_authorized on public.audit_logs for select to authenticated using (
  organization_id is not null and public.has_permission(organization_id, 'audit.read')
);

revoke all on public.audit_logs from anon;
revoke insert, update, delete on public.audit_logs from authenticated;

grant select on public.organizations, public.branches, public.profiles, public.roles, public.permissions, public.role_permissions, public.organization_memberships, public.branch_memberships to authenticated;
grant update (display_name, preferred_locale, phone) on public.profiles to authenticated;
grant select on public.audit_logs to authenticated;
