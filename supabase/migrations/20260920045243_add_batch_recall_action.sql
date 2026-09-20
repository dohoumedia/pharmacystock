-- Add a controlled batch recall action using the existing expiry-management permission.
alter table public.expiry_actions
  drop constraint if exists expiry_actions_action_type_check;

alter table public.expiry_actions
  add constraint expiry_actions_action_type_check
  check (action_type = any (array[
    'PRIORITIZE_SALE'::text,
    'QUARANTINE'::text,
    'RELEASE_QUARANTINE'::text,
    'RECALL'::text,
    'DISPOSE'::text,
    'SUPPLIER_RETURN'::text
  ]));

create or replace function app_private.record_expiry_action_impl(
  p_batch_id uuid,
  p_action_type text,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path=public,app_private,pg_temp
as $$
declare
  v_batch public.batches%rowtype;
  v_id uuid;
begin
  select * into v_batch
  from public.batches
  where id=p_batch_id
  for update;

  if not found then
    raise exception using errcode='P0002',message='BATCH_NOT_FOUND';
  end if;

  if not app_private.has_branch_access(v_batch.branch_id)
    or not app_private.has_permission(v_batch.organization_id,'inventory.expiry.manage') then
    raise exception using errcode='42501',message='EXPIRY_MANAGE_FORBIDDEN';
  end if;

  if p_action_type not in ('PRIORITIZE_SALE','QUARANTINE','RELEASE_QUARANTINE','RECALL') then
    raise exception using errcode='23514',message='INVALID_EXPIRY_ACTION';
  end if;

  if p_action_type='PRIORITIZE_SALE' then
    if v_batch.status<>'ACTIVE' or v_batch.expiry_date<current_date then
      raise exception using errcode='23514',message='BATCH_NOT_ELIGIBLE_FOR_PRIORITY_SALE';
    end if;
  elsif p_action_type='QUARANTINE' then
    if v_batch.status<>'ACTIVE' then
      raise exception using errcode='23514',message='BATCH_NOT_ELIGIBLE_FOR_QUARANTINE';
    end if;
    update public.batches set status='QUARANTINED' where id=v_batch.id;
  elsif p_action_type='RELEASE_QUARANTINE' then
    if v_batch.status<>'QUARANTINED' or v_batch.expiry_date<current_date then
      raise exception using errcode='23514',message='BATCH_NOT_ELIGIBLE_FOR_RELEASE';
    end if;
    update public.batches set status='ACTIVE' where id=v_batch.id;
  elsif p_action_type='RECALL' then
    if v_batch.status not in ('ACTIVE','QUARANTINED') then
      raise exception using errcode='23514',message='BATCH_NOT_ELIGIBLE_FOR_RECALL';
    end if;
    update public.batches set status='RECALLED' where id=v_batch.id;
  end if;

  insert into public.expiry_actions(
    organization_id,branch_id,batch_id,action_type,reason,actor_user_id
  )
  values(
    v_batch.organization_id,
    v_batch.branch_id,
    v_batch.id,
    p_action_type,
    nullif(trim(p_reason),''),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;
