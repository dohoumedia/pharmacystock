drop policy if exists profiles_select_staff_manager on public.profiles;

create policy profiles_select_staff_manager on public.profiles
for select to authenticated using (
  exists (
    select 1
    from public.organization_memberships target_membership
    where target_membership.user_id = profiles.user_id
      and target_membership.status <> 'revoked'
      and app_private.has_permission(target_membership.organization_id, 'staff.manage')
  )
);
