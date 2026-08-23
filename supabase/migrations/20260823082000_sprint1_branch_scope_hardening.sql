drop policy if exists branches_select_member on public.branches;

create policy branches_select_member on public.branches
for select to authenticated using (
  app_private.has_permission(organization_id, 'branch.manage')
  or app_private.has_permission(organization_id, 'staff.manage')
  or app_private.has_branch_access(id)
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
      and m.user_id <> auth.uid()
      and app_private.has_permission(b.organization_id, 'staff.manage')
  )
);
