revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.has_branch_access(uuid) from public, anon;
revoke all on function public.has_permission(uuid, text) from public, anon;

grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_branch_access(uuid) to authenticated;
grant execute on function public.has_permission(uuid, text) to authenticated;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;
