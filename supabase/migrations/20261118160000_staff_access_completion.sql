-- ORG-FR-003, AUTH-FR-006. Local functional completion; no production application.
-- Existing membership, role and branch tables remain the only access model.
create function app_private.my_membership_unavailable()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.organization_memberships where user_id=auth.uid());
$$;
create function public.my_membership_unavailable()
returns boolean language sql stable security invoker set search_path = '' as $$ select app_private.my_membership_unavailable(); $$;
revoke all on function app_private.my_membership_unavailable(),public.my_membership_unavailable() from public,anon;
grant execute on function app_private.my_membership_unavailable(),public.my_membership_unavailable() to authenticated;
create function app_private.staff_directory_details(p_organization_id uuid)
returns table(user_id uuid, email text, access_changed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not app_private.has_permission(p_organization_id,'staff.manage') then raise exception 'AUTH_FORBIDDEN'; end if;
  return query select m.user_id,u.email::text,greatest(m.updated_at,
    (select max(a.created_at) from public.audit_logs a where a.organization_id=p_organization_id
      and a.entity_type='organization_memberships' and a.entity_id=m.id::text and a.event_type='staff.branches_changed'))
    from public.organization_memberships m join auth.users u on u.id=m.user_id where m.organization_id=p_organization_id;
end;
$$;

-- Compare complete observed state, then apply the desired state atomically.
-- Repeating the same request after a lost response is a no-op, including audits.
create function app_private.maintain_staff_access(p_membership_id uuid,p_expected jsonb,p_next jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare member public.organization_memberships; current_state jsonb; next_ids uuid[]; current_ids uuid[]; next_role uuid; next_status text;
begin
  select * into member from public.organization_memberships where id=p_membership_id;
  if auth.uid() is null or member.id is null or member.user_id=auth.uid()
    or not app_private.has_permission(member.organization_id,'staff.manage') then raise exception 'AUTH_FORBIDDEN'; end if;
  -- Serialize the supported maintenance path for this organization.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staff_access:'||member.organization_id::text,0));
  select * into member from public.organization_memberships where id=p_membership_id for update;
  if exists(select 1 from public.roles where id=member.role_id and code='OWNER') then raise exception 'STAFF_OWNER_PROTECTED'; end if;
  if p_next is null or pg_catalog.jsonb_typeof(p_next->'branch_ids') is distinct from 'array'
    or p_next->>'status' is null or p_next->>'status' not in ('active','suspended') then raise exception 'STAFF_ACCESS_INVALID'; end if;
  next_role := (p_next->>'role_id')::uuid; next_status := p_next->>'status';
  if not exists(select 1 from public.roles where id=next_role and code<>'OWNER' and (organization_id is null or organization_id=member.organization_id)) then raise exception 'STAFF_ACCESS_INVALID'; end if;
  select coalesce(array_agg(id order by id),'{}'::uuid[]) into next_ids from (select distinct value::uuid id from pg_catalog.jsonb_array_elements_text(p_next->'branch_ids')) s;
  select coalesce(array_agg(branch_id order by branch_id),'{}'::uuid[]) into current_ids from public.branch_memberships where organization_membership_id=member.id;
  current_state:=pg_catalog.jsonb_build_object('role_id',member.role_id,'status',member.status,'branch_ids',current_ids);
  if current_state=pg_catalog.jsonb_build_object('role_id',next_role,'status',next_status,'branch_ids',next_ids) then return; end if;
  if current_state is distinct from p_expected then raise exception 'STAFF_ACCESS_CHANGED'; end if;
  -- Existing inactive assignments may be retained, but cannot be newly assigned.
  if exists(select 1 from unnest(next_ids) id where not exists(select 1 from public.branches b where b.id=id and b.organization_id=member.organization_id and (b.status='active' or id=any(current_ids)))) then raise exception 'STAFF_ACCESS_INVALID'; end if;
  -- Zero assigned branches is supported by the existing membership model.
  -- Non-manager staff then see the explicit no-access state; no permissions are invented.
  if member.role_id is distinct from next_role or member.status<>next_status then
    update public.organization_memberships set role_id=next_role,status=next_status where id=member.id;
  end if;
  if current_ids is distinct from next_ids then
    delete from public.branch_memberships where organization_membership_id=member.id and not(branch_id=any(next_ids));
    insert into public.branch_memberships(branch_id,organization_membership_id) select id,member.id from unnest(next_ids) id on conflict do nothing;
    insert into public.audit_logs(organization_id,actor_user_id,event_type,entity_type,entity_id,before_data,after_data)
      values(member.organization_id,auth.uid(),'staff.branches_changed','organization_memberships',member.id::text,
        pg_catalog.jsonb_build_object('branch_ids',current_ids),pg_catalog.jsonb_build_object('branch_ids',next_ids));
  end if;
end;
$$;

create function public.staff_directory_details(p_organization_id uuid)
returns table(user_id uuid,email text,access_changed_at timestamptz)
language sql stable security invoker set search_path = '' as $$ select * from app_private.staff_directory_details(p_organization_id); $$;
create function public.maintain_staff_access(p_membership_id uuid,p_expected jsonb,p_next jsonb)
returns void language sql security invoker set search_path = '' as $$ select app_private.maintain_staff_access(p_membership_id,p_expected,p_next); $$;
revoke all on function app_private.staff_directory_details(uuid),public.staff_directory_details(uuid),app_private.maintain_staff_access(uuid,jsonb,jsonb),public.maintain_staff_access(uuid,jsonb,jsonb) from public,anon;
grant execute on function app_private.staff_directory_details(uuid),public.staff_directory_details(uuid),app_private.maintain_staff_access(uuid,jsonb,jsonb),public.maintain_staff_access(uuid,jsonb,jsonb) to authenticated;
