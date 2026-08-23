create or replace function public.refresh_expiry_alerts(p_organization_id uuid,p_branch_id uuid default null)
returns integer language plpgsql security invoker set search_path=public,app_private,pg_temp as $$
begin
  if not app_private.is_org_member(p_organization_id) or not app_private.has_permission(p_organization_id,'inventory.read') then raise exception using errcode='42501',message='INVENTORY_READ_FORBIDDEN'; end if;
  if p_branch_id is null then
    if not app_private.has_permission(p_organization_id,'branch.manage') then raise exception using errcode='42501',message='BRANCH_SCOPE_REQUIRED'; end if;
  elsif not app_private.has_branch_access(p_branch_id) then raise exception using errcode='42501',message='BRANCH_ACCESS_DENIED'; end if;
  return app_private.refresh_expiry_alerts_impl(p_organization_id,p_branch_id);
end; $$;

create or replace function app_private.acknowledge_expiry_alert_impl(p_alert_id uuid)
returns uuid language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_alert public.expiry_alerts%rowtype;
begin
  select * into v_alert from public.expiry_alerts where id=p_alert_id for update;
  if not found then raise exception using errcode='P0002',message='EXPIRY_ALERT_NOT_FOUND'; end if;
  if not app_private.is_org_member(v_alert.organization_id) or not app_private.has_branch_access(v_alert.branch_id) or not app_private.has_permission(v_alert.organization_id,'inventory.expiry.manage') then raise exception using errcode='42501',message='EXPIRY_MANAGE_FORBIDDEN'; end if;
  if v_alert.status='RESOLVED' then return v_alert.id; end if;
  update public.expiry_alerts set status='ACKNOWLEDGED',acknowledged_by=auth.uid(),acknowledged_at=now() where id=v_alert.id;
  return v_alert.id;
end; $$;
create or replace function public.acknowledge_expiry_alert(p_alert_id uuid) returns uuid language sql security invoker set search_path=public,app_private,pg_temp as $$ select app_private.acknowledge_expiry_alert_impl(p_alert_id); $$;

create or replace function app_private.record_expiry_action_impl(p_batch_id uuid,p_action_type text,p_reason text default null)
returns uuid language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_batch public.batches%rowtype; v_id uuid;
begin
  select * into v_batch from public.batches where id=p_batch_id for update;
  if not found then raise exception using errcode='P0002',message='BATCH_NOT_FOUND'; end if;
  if not app_private.has_branch_access(v_batch.branch_id) or not app_private.has_permission(v_batch.organization_id,'inventory.expiry.manage') then raise exception using errcode='42501',message='EXPIRY_MANAGE_FORBIDDEN'; end if;
  if p_action_type not in ('PRIORITIZE_SALE','QUARANTINE','RELEASE_QUARANTINE') then raise exception using errcode='23514',message='INVALID_EXPIRY_ACTION'; end if;
  if p_action_type='PRIORITIZE_SALE' then
    if v_batch.status<>'ACTIVE' or v_batch.expiry_date<current_date then raise exception using errcode='23514',message='BATCH_NOT_ELIGIBLE_FOR_PRIORITY_SALE'; end if;
  elsif p_action_type='QUARANTINE' then
    if v_batch.status<>'ACTIVE' then raise exception using errcode='23514',message='BATCH_NOT_ELIGIBLE_FOR_QUARANTINE'; end if;
    update public.batches set status='QUARANTINED' where id=v_batch.id;
  elsif p_action_type='RELEASE_QUARANTINE' then
    if v_batch.status<>'QUARANTINED' or v_batch.expiry_date<current_date then raise exception using errcode='23514',message='BATCH_NOT_ELIGIBLE_FOR_RELEASE'; end if;
    update public.batches set status='ACTIVE' where id=v_batch.id;
  end if;
  insert into public.expiry_actions(organization_id,branch_id,batch_id,action_type,reason,actor_user_id)
  values(v_batch.organization_id,v_batch.branch_id,v_batch.id,p_action_type,nullif(trim(p_reason),''),auth.uid()) returning id into v_id;
  return v_id;
end; $$;
create or replace function public.record_expiry_action(p_batch_id uuid,p_action_type text,p_reason text default null) returns uuid language sql security invoker set search_path=public,app_private,pg_temp as $$ select app_private.record_expiry_action_impl(p_batch_id,p_action_type,p_reason); $$;

create or replace function app_private.dispose_batch_impl(p_batch_id uuid,p_reason text,p_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_batch public.batches%rowtype; v_on_hand numeric(18,4); v_action uuid;
begin
  select * into v_batch from public.batches where id=p_batch_id for update;
  if not found then raise exception using errcode='P0002',message='BATCH_NOT_FOUND'; end if;
  if not app_private.has_branch_access(v_batch.branch_id) or not app_private.has_permission(v_batch.organization_id,'inventory.dispose') then raise exception using errcode='42501',message='INVENTORY_DISPOSE_FORBIDDEN'; end if;
  if coalesce(trim(p_idempotency_key),'')='' then raise exception using errcode='23514',message='IDEMPOTENCY_KEY_REQUIRED'; end if;
  select coalesce(sum(quantity_delta),0)::numeric(18,4) into v_on_hand from public.inventory_movements where organization_id=v_batch.organization_id and branch_id=v_batch.branch_id and batch_id=v_batch.id;
  if v_on_hand>0 then
    perform public.post_inventory_movement(v_batch.organization_id,v_batch.branch_id,v_batch.id,'DISPOSAL',-v_on_hand,p_idempotency_key,coalesce(nullif(trim(p_reason),''),'Batch disposal'),'EXPIRY_ACTION',v_batch.id::text,v_batch.purchase_cost,jsonb_build_object('expiry_date',v_batch.expiry_date,'previous_status',v_batch.status),now());
  end if;
  update public.batches set status='DISPOSED' where id=v_batch.id and status<>'DISPOSED';
  select id into v_action from public.expiry_actions where organization_id=v_batch.organization_id and batch_id=v_batch.id and action_type='DISPOSE' and metadata->>'idempotency_key'=p_idempotency_key limit 1;
  if v_action is null then insert into public.expiry_actions(organization_id,branch_id,batch_id,action_type,quantity,reason,actor_user_id,metadata) values(v_batch.organization_id,v_batch.branch_id,v_batch.id,'DISPOSE',v_on_hand,nullif(trim(p_reason),''),auth.uid(),jsonb_build_object('idempotency_key',p_idempotency_key)) returning id into v_action; end if;
  return v_action;
end; $$;
create or replace function public.dispose_batch(p_batch_id uuid,p_reason text,p_idempotency_key text) returns uuid language sql security invoker set search_path=public,app_private,pg_temp as $$ select app_private.dispose_batch_impl(p_batch_id,p_reason,p_idempotency_key); $$;

create or replace function app_private.return_batch_to_supplier_impl(p_batch_id uuid,p_quantity numeric,p_reason text,p_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_batch public.batches%rowtype; v_on_hand numeric(18,4); v_action uuid;
begin
  select * into v_batch from public.batches where id=p_batch_id for update;
  if not found then raise exception using errcode='P0002',message='BATCH_NOT_FOUND'; end if;
  if not app_private.has_branch_access(v_batch.branch_id) or not app_private.has_permission(v_batch.organization_id,'inventory.expiry.manage') then raise exception using errcode='42501',message='EXPIRY_MANAGE_FORBIDDEN'; end if;
  if v_batch.status in ('DISPOSED','DEPLETED') then raise exception using errcode='23514',message='BATCH_NOT_RETURNABLE'; end if;
  if p_quantity is null or p_quantity<=0 then raise exception using errcode='23514',message='INVALID_RETURN_QUANTITY'; end if;
  if coalesce(trim(p_idempotency_key),'')='' then raise exception using errcode='23514',message='IDEMPOTENCY_KEY_REQUIRED'; end if;
  select coalesce(sum(quantity_delta),0)::numeric(18,4) into v_on_hand from public.inventory_movements where organization_id=v_batch.organization_id and branch_id=v_batch.branch_id and batch_id=v_batch.id;
  if p_quantity>v_on_hand then raise exception using errcode='23514',message='INSUFFICIENT_STOCK'; end if;
  perform public.post_inventory_movement(v_batch.organization_id,v_batch.branch_id,v_batch.id,'SUPPLIER_RETURN',-p_quantity,p_idempotency_key,coalesce(nullif(trim(p_reason),''),'Supplier return'),'EXPIRY_ACTION',v_batch.id::text,v_batch.purchase_cost,jsonb_build_object('expiry_date',v_batch.expiry_date),now());
  if v_on_hand-p_quantity=0 then update public.batches set status='DEPLETED' where id=v_batch.id; end if;
  select id into v_action from public.expiry_actions where organization_id=v_batch.organization_id and batch_id=v_batch.id and action_type='SUPPLIER_RETURN' and metadata->>'idempotency_key'=p_idempotency_key limit 1;
  if v_action is null then insert into public.expiry_actions(organization_id,branch_id,batch_id,action_type,quantity,reason,actor_user_id,metadata) values(v_batch.organization_id,v_batch.branch_id,v_batch.id,'SUPPLIER_RETURN',p_quantity,nullif(trim(p_reason),''),auth.uid(),jsonb_build_object('idempotency_key',p_idempotency_key)) returning id into v_action; end if;
  return v_action;
end; $$;
create or replace function public.return_batch_to_supplier(p_batch_id uuid,p_quantity numeric,p_reason text,p_idempotency_key text) returns uuid language sql security invoker set search_path=public,app_private,pg_temp as $$ select app_private.return_batch_to_supplier_impl(p_batch_id,p_quantity,p_reason,p_idempotency_key); $$;

revoke all on function app_private.acknowledge_expiry_alert_impl(uuid) from public,anon;
revoke all on function app_private.record_expiry_action_impl(uuid,text,text) from public,anon;
revoke all on function app_private.dispose_batch_impl(uuid,text,text) from public,anon;
revoke all on function app_private.return_batch_to_supplier_impl(uuid,numeric,text,text) from public,anon;
grant execute on function app_private.acknowledge_expiry_alert_impl(uuid),app_private.record_expiry_action_impl(uuid,text,text),app_private.dispose_batch_impl(uuid,text,text),app_private.return_batch_to_supplier_impl(uuid,numeric,text,text) to authenticated;
revoke all on function public.acknowledge_expiry_alert(uuid),public.record_expiry_action(uuid,text,text),public.dispose_batch(uuid,text,text),public.return_batch_to_supplier(uuid,numeric,text,text) from public,anon;
grant execute on function public.acknowledge_expiry_alert(uuid),public.record_expiry_action(uuid,text,text),public.dispose_batch(uuid,text,text),public.return_batch_to_supplier(uuid,numeric,text,text) to authenticated;
