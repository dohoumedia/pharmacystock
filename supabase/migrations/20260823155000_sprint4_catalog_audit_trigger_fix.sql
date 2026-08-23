create or replace function app_private.audit_catalog_change()
returns trigger language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) else null end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) else null end;
  v_org uuid;
  v_branch uuid;
  v_entity_id text;
begin
  v_org := coalesce(nullif(v_new->>'organization_id','')::uuid, nullif(v_old->>'organization_id','')::uuid);
  v_branch := coalesce(nullif(v_new->>'branch_id','')::uuid, nullif(v_old->>'branch_id','')::uuid);
  v_entity_id := coalesce(v_new->>'id',v_old->>'id');
  insert into public.audit_logs(organization_id,branch_id,actor_user_id,event_type,entity_type,entity_id,before_data,after_data)
  values(v_org,v_branch,auth.uid(),lower(tg_table_name)||'.'||lower(tg_op),tg_table_name,v_entity_id,
    case when tg_op in ('UPDATE','DELETE') then v_old else null end,
    case when tg_op in ('INSERT','UPDATE') then v_new else null end);
  return coalesce(new,old);
end;
$$;
