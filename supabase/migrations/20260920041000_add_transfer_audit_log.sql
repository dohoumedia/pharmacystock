-- Record stock-transfer lifecycle transitions in the append-oriented audit log.
create or replace function app_private.create_stock_transfer_impl(
 p_organization_id uuid,p_source_branch_id uuid,p_destination_branch_id uuid,p_transfer_number text,
 p_lines jsonb,p_idempotency_key text,p_notes text default null
) returns uuid language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_id uuid; v_line jsonb; v_batch public.batches%rowtype; v_qty numeric;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
 if not app_private.is_org_member(p_organization_id) or not app_private.has_permission(p_organization_id,'transfer.create') then raise exception using errcode='42501',message='TRANSFER_CREATE_FORBIDDEN'; end if;
 if nullif(trim(p_transfer_number),'') is null then raise exception using errcode='23514',message='TRANSFER_NUMBER_REQUIRED'; end if;
 if nullif(trim(p_idempotency_key),'') is null then raise exception using errcode='23514',message='TRANSFER_IDEMPOTENCY_KEY_REQUIRED'; end if;
 if p_source_branch_id=p_destination_branch_id then raise exception using errcode='23514',message='TRANSFER_SAME_BRANCH'; end if;
 if not app_private.has_branch_access(p_source_branch_id) and not app_private.has_permission(p_organization_id,'branch.manage') then raise exception using errcode='42501',message='SOURCE_BRANCH_ACCESS_DENIED'; end if;
 if not exists(select 1 from public.branches where id=p_destination_branch_id and organization_id=p_organization_id and status='active') then raise exception using errcode='23503',message='DESTINATION_BRANCH_INVALID'; end if;
 select id into v_id from public.stock_transfers where organization_id=p_organization_id and idempotency_key=trim(p_idempotency_key);
 if v_id is not null then return v_id; end if;
 if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception using errcode='23514',message='TRANSFER_LINES_REQUIRED'; end if;
 insert into public.stock_transfers(organization_id,source_branch_id,destination_branch_id,transfer_number,status,notes,idempotency_key,requested_by)
 values(p_organization_id,p_source_branch_id,p_destination_branch_id,trim(p_transfer_number),'REQUESTED',nullif(trim(p_notes),''),trim(p_idempotency_key),auth.uid()) returning id into v_id;
 for v_line in select * from jsonb_array_elements(p_lines) loop
  if nullif(v_line->>'source_batch_id','') is null then raise exception using errcode='23514',message='TRANSFER_SOURCE_BATCH_REQUIRED'; end if;
  select * into v_batch from public.batches where id=(v_line->>'source_batch_id')::uuid and organization_id=p_organization_id for share;
  if not found or v_batch.branch_id<>p_source_branch_id then raise exception using errcode='23514',message='TRANSFER_SOURCE_BATCH_INVALID'; end if;
  if v_batch.status<>'ACTIVE' or v_batch.expiry_date<current_date then raise exception using errcode='23514',message='TRANSFER_SOURCE_BATCH_NOT_ELIGIBLE'; end if;
  v_qty=nullif(v_line->>'quantity','')::numeric;
  if v_qty is null or v_qty<=0 then raise exception using errcode='23514',message='TRANSFER_QUANTITY_INVALID'; end if;
  insert into public.stock_transfer_lines(organization_id,transfer_id,source_batch_id,product_id,requested_quantity)
  values(p_organization_id,v_id,v_batch.id,v_batch.product_id,v_qty);
 end loop;
 insert into public.audit_logs(organization_id,branch_id,actor_user_id,event_type,entity_type,entity_id,metadata)
 values(
  p_organization_id,p_source_branch_id,auth.uid(),'transfer.created','stock_transfer',v_id::text,
  jsonb_build_object(
   'transfer_id',v_id,
   'transfer_number',trim(p_transfer_number),
   'source_branch_id',p_source_branch_id,
   'destination_branch_id',p_destination_branch_id,
   'line_count',(select count(*) from public.stock_transfer_lines where transfer_id=v_id),
   'requested_quantity',(select coalesce(sum(requested_quantity),0) from public.stock_transfer_lines where transfer_id=v_id)
  )
 );
 return v_id;
end $$;

create or replace function app_private.approve_stock_transfer_impl(p_transfer_id uuid)
returns uuid language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_t public.stock_transfers%rowtype;
begin
 select * into v_t from public.stock_transfers where id=p_transfer_id for update;
 if not found then raise exception using errcode='P0002',message='TRANSFER_NOT_FOUND'; end if;
 if v_t.status<>'REQUESTED' then raise exception using errcode='23514',message='TRANSFER_NOT_REQUESTED'; end if;
 if not app_private.has_permission(v_t.organization_id,'transfer.approve') then raise exception using errcode='42501',message='TRANSFER_APPROVE_FORBIDDEN'; end if;
 if not app_private.has_branch_access(v_t.source_branch_id)
    and not app_private.has_branch_access(v_t.destination_branch_id)
    and not app_private.has_permission(v_t.organization_id,'branch.manage') then
   raise exception using errcode='42501',message='TRANSFER_APPROVE_BRANCH_FORBIDDEN';
 end if;
 update public.stock_transfers set status='APPROVED',approved_by=auth.uid(),approved_at=now() where id=p_transfer_id;
 insert into public.audit_logs(organization_id,branch_id,actor_user_id,event_type,entity_type,entity_id,metadata)
 values(
  v_t.organization_id,v_t.source_branch_id,auth.uid(),'transfer.approved','stock_transfer',p_transfer_id::text,
  jsonb_build_object(
   'transfer_id',p_transfer_id,
   'transfer_number',v_t.transfer_number,
   'source_branch_id',v_t.source_branch_id,
   'destination_branch_id',v_t.destination_branch_id,
   'status','APPROVED'
  )
 );
 return p_transfer_id;
end $$;

create or replace function app_private.dispatch_stock_transfer_impl(p_transfer_id uuid)
returns uuid language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_t public.stock_transfers%rowtype; v_line public.stock_transfer_lines%rowtype; v_batch public.batches%rowtype; v_mov uuid;
begin
 select * into v_t from public.stock_transfers where id=p_transfer_id for update;
 if not found then raise exception using errcode='P0002',message='TRANSFER_NOT_FOUND'; end if;
 if v_t.status='DISPATCHED' then return p_transfer_id; end if;
 if v_t.status<>'APPROVED' then raise exception using errcode='23514',message='TRANSFER_NOT_APPROVED'; end if;
 if not app_private.has_permission(v_t.organization_id,'transfer.dispatch') or (not app_private.has_branch_access(v_t.source_branch_id) and not app_private.has_permission(v_t.organization_id,'branch.manage')) then raise exception using errcode='42501',message='TRANSFER_DISPATCH_FORBIDDEN'; end if;
 for v_line in select * from public.stock_transfer_lines where transfer_id=p_transfer_id order by id for update loop
  select * into v_batch from public.batches where id=v_line.source_batch_id and organization_id=v_t.organization_id;
  if v_batch.status<>'ACTIVE' or v_batch.expiry_date<current_date then raise exception using errcode='23514',message='TRANSFER_SOURCE_BATCH_NOT_ELIGIBLE'; end if;
  v_mov:=public.post_inventory_movement(v_t.organization_id,v_t.source_branch_id,v_line.source_batch_id,'TRANSFER_OUT',-v_line.requested_quantity,
    'transfer:'||p_transfer_id::text||':out:'||v_line.id::text,'Inter-branch transfer dispatch','STOCK_TRANSFER',p_transfer_id::text,v_batch.purchase_cost,
    jsonb_build_object('destination_branch_id',v_t.destination_branch_id),now());
  update public.stock_transfer_lines set dispatched_quantity=requested_quantity,transfer_out_movement_id=v_mov where id=v_line.id;
 end loop;
 update public.stock_transfers set status='DISPATCHED',dispatched_by=auth.uid(),dispatched_at=now() where id=p_transfer_id;
 insert into public.audit_logs(organization_id,branch_id,actor_user_id,event_type,entity_type,entity_id,metadata)
 values(
  v_t.organization_id,v_t.source_branch_id,auth.uid(),'transfer.dispatched','stock_transfer',p_transfer_id::text,
  jsonb_build_object(
   'transfer_id',p_transfer_id,
   'transfer_number',v_t.transfer_number,
   'source_branch_id',v_t.source_branch_id,
   'destination_branch_id',v_t.destination_branch_id,
   'dispatched_quantity',(select coalesce(sum(dispatched_quantity),0) from public.stock_transfer_lines where transfer_id=p_transfer_id),
   'status','DISPATCHED'
  )
 );
 return p_transfer_id;
end $$;

create or replace function app_private.receive_stock_transfer_impl(p_transfer_id uuid,p_received_lines jsonb default null,p_discrepancy_notes text default null)
returns uuid language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_t public.stock_transfers%rowtype; v_line public.stock_transfer_lines%rowtype; v_source public.batches%rowtype; v_dest uuid; v_received numeric; v_reason text; v_mov uuid; v_has_discrepancy boolean:=false; v_final_status text;
begin
 select * into v_t from public.stock_transfers where id=p_transfer_id for update;
 if not found then raise exception using errcode='P0002',message='TRANSFER_NOT_FOUND'; end if;
 if v_t.status in ('RECEIVED','RECEIVED_WITH_DISCREPANCY') then return p_transfer_id; end if;
 if v_t.status<>'DISPATCHED' then raise exception using errcode='23514',message='TRANSFER_NOT_DISPATCHED'; end if;
 if not app_private.has_permission(v_t.organization_id,'transfer.receive') or (not app_private.has_branch_access(v_t.destination_branch_id) and not app_private.has_permission(v_t.organization_id,'branch.manage')) then raise exception using errcode='42501',message='TRANSFER_RECEIVE_FORBIDDEN'; end if;
 for v_line in select * from public.stock_transfer_lines where transfer_id=p_transfer_id order by id for update loop
  select * into v_source from public.batches where id=v_line.source_batch_id and organization_id=v_t.organization_id;
  if p_received_lines is null then v_received:=v_line.dispatched_quantity; v_reason:=null;
  else
   select coalesce((x->>'quantity')::numeric,0),nullif(trim(x->>'reason'),'') into v_received,v_reason
   from jsonb_array_elements(p_received_lines) x where (x->>'line_id')::uuid=v_line.id limit 1;
   v_received:=coalesce(v_received,0);
  end if;
  if v_received<0 or v_received>v_line.dispatched_quantity then raise exception using errcode='23514',message='TRANSFER_RECEIVED_QUANTITY_INVALID'; end if;
  if v_received<>v_line.dispatched_quantity then v_has_discrepancy:=true; end if;
  if v_received>0 then
   select id into v_dest from public.batches where organization_id=v_t.organization_id and branch_id=v_t.destination_branch_id and product_id=v_line.product_id and lot_number=v_source.lot_number and expiry_date=v_source.expiry_date order by created_at limit 1;
   if v_dest is null then
    insert into public.batches(organization_id,branch_id,product_id,lot_number,expiry_date,purchase_cost,selling_price,status,notes)
    values(v_t.organization_id,v_t.destination_branch_id,v_line.product_id,v_source.lot_number,v_source.expiry_date,v_source.purchase_cost,v_source.selling_price,
      case when v_source.expiry_date<current_date then 'EXPIRED' else 'ACTIVE' end,'Created by inter-branch transfer') returning id into v_dest;
   end if;
   v_mov:=public.post_inventory_movement(v_t.organization_id,v_t.destination_branch_id,v_dest,'TRANSFER_IN',v_received,
     'transfer:'||p_transfer_id::text||':in:'||v_line.id::text,'Inter-branch transfer receipt','STOCK_TRANSFER',p_transfer_id::text,v_source.purchase_cost,
     jsonb_build_object('source_branch_id',v_t.source_branch_id,'source_batch_id',v_line.source_batch_id),now());
  else v_dest:=null; v_mov:=null; end if;
  update public.stock_transfer_lines set destination_batch_id=v_dest,received_quantity=v_received,discrepancy_quantity=v_line.dispatched_quantity-v_received,discrepancy_reason=v_reason,transfer_in_movement_id=v_mov where id=v_line.id;
 end loop;
 v_final_status:=case when v_has_discrepancy then 'RECEIVED_WITH_DISCREPANCY' else 'RECEIVED' end;
 update public.stock_transfers set status=v_final_status,
  discrepancy_notes=nullif(trim(p_discrepancy_notes),''),received_by=auth.uid(),received_at=now() where id=p_transfer_id;
 insert into public.audit_logs(organization_id,branch_id,actor_user_id,event_type,entity_type,entity_id,metadata)
 values(
  v_t.organization_id,v_t.destination_branch_id,auth.uid(),'transfer.received','stock_transfer',p_transfer_id::text,
  jsonb_build_object(
   'transfer_id',p_transfer_id,
   'transfer_number',v_t.transfer_number,
   'source_branch_id',v_t.source_branch_id,
   'destination_branch_id',v_t.destination_branch_id,
   'received_quantity',(select coalesce(sum(received_quantity),0) from public.stock_transfer_lines where transfer_id=p_transfer_id),
   'discrepancy_quantity',(select coalesce(sum(discrepancy_quantity),0) from public.stock_transfer_lines where transfer_id=p_transfer_id),
   'discrepancy_notes',nullif(trim(p_discrepancy_notes),''),
   'status',v_final_status
  )
 );
 return p_transfer_id;
end $$;
