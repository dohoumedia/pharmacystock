create index if not exists audit_logs_actor_user_id_idx on public.audit_logs(actor_user_id);
create index if not exists audit_logs_branch_id_idx on public.audit_logs(branch_id);
create index if not exists audit_logs_organization_id_idx on public.audit_logs(organization_id);
create index if not exists branch_memberships_organization_membership_id_idx on public.branch_memberships(organization_membership_id);
create index if not exists organization_memberships_role_id_idx on public.organization_memberships(role_id);
create index if not exists organization_memberships_user_id_idx on public.organization_memberships(user_id);
create index if not exists role_permissions_permission_code_idx on public.role_permissions(permission_code);

drop policy if exists profiles_select_self on public.profiles;
drop policy if exists profiles_select_staff_manager on public.profiles;
create policy profiles_select_authorized on public.profiles
for select to authenticated using (
  user_id = (select auth.uid())
  or exists (
    select 1
    from public.organization_memberships target_membership
    where target_membership.user_id = profiles.user_id
      and target_membership.status <> 'revoked'
      and app_private.has_permission(target_membership.organization_id, 'staff.manage')
  )
);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists memberships_insert_staff_manager on public.organization_memberships;
create policy memberships_insert_staff_manager on public.organization_memberships
for insert to authenticated
with check (
  app_private.has_permission(organization_id, 'staff.manage')
  and user_id <> (select auth.uid())
  and app_private.role_is_assignable(organization_id, role_id)
);

drop policy if exists memberships_update_staff_manager on public.organization_memberships;
create policy memberships_update_staff_manager on public.organization_memberships
for update to authenticated
using (
  app_private.has_permission(organization_id, 'staff.manage')
  and user_id <> (select auth.uid())
)
with check (
  app_private.has_permission(organization_id, 'staff.manage')
  and user_id <> (select auth.uid())
  and app_private.role_is_assignable(organization_id, role_id)
);

drop policy if exists branch_memberships_insert_staff_manager on public.branch_memberships;
create policy branch_memberships_insert_staff_manager on public.branch_memberships
for insert to authenticated with check (
  exists (
    select 1
    from public.branches b
    join public.organization_memberships m on m.id = organization_membership_id
    where b.id = branch_id
      and b.organization_id = m.organization_id
      and m.user_id <> (select auth.uid())
      and app_private.has_permission(b.organization_id, 'staff.manage')
  )
);

drop policy if exists branch_memberships_delete_staff_manager on public.branch_memberships;
create policy branch_memberships_delete_staff_manager on public.branch_memberships
for delete to authenticated using (
  exists (
    select 1
    from public.branches b
    join public.organization_memberships m on m.id = organization_membership_id
    where b.id = branch_id
      and b.organization_id = m.organization_id
      and app_private.has_permission(b.organization_id, 'staff.manage')
      and m.user_id <> (select auth.uid())
  )
);
