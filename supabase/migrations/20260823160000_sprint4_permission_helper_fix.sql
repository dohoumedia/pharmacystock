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
    where m.organization_id = $1
      and m.user_id = auth.uid()
      and m.status = 'active'
      and rp.permission_code = $2
  );
$$;
