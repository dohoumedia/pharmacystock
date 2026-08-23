create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated;

create or replace function app_private.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app_private
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = target_org
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function app_private.has_branch_access(target_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app_private
as $$
  select exists (
    select 1
    from public.branch_memberships bm
    join public.organization_memberships m on m.id = bm.organization_membership_id
    where bm.branch_id = target_branch
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function app_private.has_permission(target_org uuid, permission_code text)
returns boolean
language sql
stable
security definer
set search_path = public, app_private
as $$
  select exists (
    select 1
    from public.organization_memberships m
    join public.roles r on r.id = m.role_id
    join public.role_permissions rp on rp.role_id = r.id
    where m.organization_id = target_org
      and m.user_id = auth.uid()
      and m.status = 'active'
      and rp.permission_code = permission_code
  );
$$;

create or replace function app_private.current_role_code(target_org uuid)
returns text
language sql
stable
security definer
set search_path = public, app_private
as $$
  select r.code
  from public.organization_memberships m
  join public.roles r on r.id = m.role_id
  where m.organization_id = target_org
    and m.user_id = auth.uid()
    and m.status = 'active'
  limit 1;
$$;

create or replace function app_private.role_is_assignable(target_org uuid, target_role uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app_private
as $$
  select exists (
    select 1
    from public.roles r
    where r.id = target_role
      and (r.organization_id is null or r.organization_id = target_org)
      and (
        r.code <> 'OWNER'
        or app_private.current_role_code(target_org) = 'OWNER'
      )
  );
$$;

grant execute on function app_private.is_org_member(uuid) to authenticated;
grant execute on function app_private.has_branch_access(uuid) to authenticated;
grant execute on function app_private.has_permission(uuid, text) to authenticated;
grant execute on function app_private.current_role_code(uuid) to authenticated;
grant execute on function app_private.role_is_assignable(uuid, uuid) to authenticated;

create unique index if not exists roles_system_code_unique
on public.roles(code)
where organization_id is null;

insert into public.roles (organization_id, code, name_en, name_fr, is_system)
values
  (null, 'OWNER', 'Owner', 'Propriétaire', true),
  (null, 'MANAGER', 'Manager', 'Gérant', true),
  (null, 'PHARMACIST', 'Pharmacist', 'Pharmacien', true),
  (null, 'INVENTORY_OFFICER', 'Inventory Officer', 'Responsable du stock', true),
  (null, 'CASHIER', 'Cashier', 'Caissier', true),
  (null, 'AUDITOR', 'Read-only / Auditor', 'Lecture seule / Auditeur', true)
on conflict (code) where organization_id is null
  do update set name_en = excluded.name_en, name_fr = excluded.name_fr, is_system = true;

insert into public.role_permissions(role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p
where r.organization_id is null and r.code = 'OWNER'
on conflict do nothing;

insert into public.role_permissions(role_id, permission_code)
select r.id, p.code from public.roles r join public.permissions p on p.code = any(array[
  'branch.manage','staff.manage','inventory.read','inventory.product.create','inventory.product.update',
  'inventory.adjust','inventory.dispose','purchase.read','purchase.create','purchase.receive',
  'sale.read','sale.create','sale.refund','customer.read','customer.manage','reports.read',
  'reports.finance.read','audit.read','exchange.publish','exchange.request','exchange.approve','reservation.manage'
]) where r.organization_id is null and r.code = 'MANAGER'
on conflict do nothing;

insert into public.role_permissions(role_id, permission_code)
select r.id, p.code from public.roles r join public.permissions p on p.code = any(array[
  'inventory.read','inventory.product.create','inventory.product.update','purchase.read','purchase.receive',
  'sale.read','sale.create','customer.read','customer.manage','reports.read','exchange.request','reservation.manage'
]) where r.organization_id is null and r.code = 'PHARMACIST'
on conflict do nothing;

insert into public.role_permissions(role_id, permission_code)
select r.id, p.code from public.roles r join public.permissions p on p.code = any(array[
  'inventory.read','inventory.product.create','inventory.product.update','inventory.adjust','inventory.dispose',
  'purchase.read','purchase.create','purchase.receive','reports.read','exchange.publish','exchange.request'
]) where r.organization_id is null and r.code = 'INVENTORY_OFFICER'
on conflict do nothing;

insert into public.role_permissions(role_id, permission_code)
select r.id, p.code from public.roles r join public.permissions p on p.code = any(array[
  'inventory.read','sale.read','sale.create','customer.read','customer.manage','reservation.manage'
]) where r.organization_id is null and r.code = 'CASHIER'
on conflict do nothing;

insert into public.role_permissions(role_id, permission_code)
select r.id, p.code from public.roles r join public.permissions p on p.code = any(array[
  'inventory.read','purchase.read','sale.read','customer.read','reports.read','audit.read'
]) where r.organization_id is null and r.code = 'AUDITOR'
on conflict do nothing;

drop policy if exists organizations_select_member on public.organizations;
drop policy if exists branches_select_member on public.branches;
drop policy if exists roles_select_member on public.roles;
drop policy if exists role_permissions_select_member on public.role_permissions;
drop policy if exists memberships_select_same_org on public.organization_memberships;
drop policy if exists branch_memberships_select_member on public.branch_memberships;
drop policy if exists audit_logs_select_authorized on public.audit_logs;

create policy organizations_select_member on public.organizations
for select to authenticated using (app_private.is_org_member(id));

create policy organizations_update_authorized on public.organizations
for update to authenticated
using (app_private.has_permission(id, 'organization.manage'))
with check (app_private.has_permission(id, 'organization.manage'));

create policy branches_select_member on public.branches
for select to authenticated using (app_private.is_org_member(organization_id));

create policy branches_insert_authorized on public.branches
for insert to authenticated
with check (app_private.has_permission(organization_id, 'branch.manage'));

create policy branches_update_authorized on public.branches
for update to authenticated
using (app_private.has_permission(organization_id, 'branch.manage'))
with check (app_private.has_permission(organization_id, 'branch.manage'));

create policy roles_select_member on public.roles
for select to authenticated
using (organization_id is null or app_private.is_org_member(organization_id));

create policy role_permissions_select_member on public.role_permissions
for select to authenticated using (
  exists (
    select 1 from public.roles r
    where r.id = role_id
      and (r.organization_id is null or app_private.is_org_member(r.organization_id))
  )
);

create policy memberships_select_same_org on public.organization_memberships
for select to authenticated using (app_private.is_org_member(organization_id));

create policy memberships_insert_staff_manager on public.organization_memberships
for insert to authenticated
with check (
  app_private.has_permission(organization_id, 'staff.manage')
  and user_id <> auth.uid()
  and app_private.role_is_assignable(organization_id, role_id)
);

create policy memberships_update_staff_manager on public.organization_memberships
for update to authenticated
using (
  app_private.has_permission(organization_id, 'staff.manage')
  and user_id <> auth.uid()
)
with check (
  app_private.has_permission(organization_id, 'staff.manage')
  and user_id <> auth.uid()
  and app_private.role_is_assignable(organization_id, role_id)
);

create policy branch_memberships_select_member on public.branch_memberships
for select to authenticated using (
  exists (
    select 1 from public.branches b
    where b.id = branch_id and app_private.is_org_member(b.organization_id)
  )
);

create policy branch_memberships_insert_staff_manager on public.branch_memberships
for insert to authenticated with check (
  exists (
    select 1
    from public.branches b
    join public.organization_memberships m on m.id = organization_membership_id
    where b.id = branch_id
      and b.organization_id = m.organization_id
      and app_private.has_permission(b.organization_id, 'staff.manage')
  )
);

create policy branch_memberships_delete_staff_manager on public.branch_memberships
for delete to authenticated using (
  exists (
    select 1
    from public.branches b
    join public.organization_memberships m on m.id = organization_membership_id
    where b.id = branch_id
      and b.organization_id = m.organization_id
      and app_private.has_permission(b.organization_id, 'staff.manage')
      and m.user_id <> auth.uid()
  )
);

create policy audit_logs_select_authorized on public.audit_logs
for select to authenticated using (
  organization_id is not null and app_private.has_permission(organization_id, 'audit.read')
);

grant insert, update on public.branches to authenticated;
grant update on public.organizations to authenticated;
grant insert, update on public.organization_memberships to authenticated;
grant insert, delete on public.branch_memberships to authenticated;

create or replace function app_private.audit_security_change()
returns trigger
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  org_id uuid;
  branch_value uuid;
begin
  org_id := coalesce(new.organization_id, old.organization_id);
  if tg_table_name = 'branches' then
    branch_value := coalesce(new.id, old.id);
  else
    branch_value := null;
  end if;

  insert into public.audit_logs(
    organization_id, branch_id, actor_user_id, event_type, entity_type, entity_id, before_data, after_data
  ) values (
    org_id,
    branch_value,
    auth.uid(),
    lower(tg_table_name) || '.' || lower(tg_op),
    tg_table_name,
    coalesce(new.id, old.id)::text,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

revoke all on function app_private.audit_security_change() from public, anon, authenticated;

drop trigger if exists organizations_security_audit on public.organizations;
create trigger organizations_security_audit
after update on public.organizations
for each row execute function app_private.audit_security_change();

drop trigger if exists branches_security_audit on public.branches;
create trigger branches_security_audit
after insert or update on public.branches
for each row execute function app_private.audit_security_change();

drop trigger if exists memberships_security_audit on public.organization_memberships;
create trigger memberships_security_audit
after insert or update on public.organization_memberships
for each row execute function app_private.audit_security_change();

drop function if exists public.is_org_member(uuid);
drop function if exists public.has_branch_access(uuid);
drop function if exists public.has_permission(uuid, text);
