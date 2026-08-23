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
 return p_transfer_id;
end $$;

create or replace function app_private.cancel_stock_transfer_impl(p_transfer_id uuid,p_reason text default null)
returns uuid language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_t public.stock_transfers%rowtype;
begin
 select * into v_t from public.stock_transfers where id=p_transfer_id for update;
 if not found then raise exception using errcode='P0002',message='TRANSFER_NOT_FOUND'; end if;
 if v_t.status not in ('REQUESTED','APPROVED') then raise exception using errcode='23514',message='TRANSFER_CANNOT_CANCEL'; end if;
 if not app_private.has_permission(v_t.organization_id,'transfer.create') then raise exception using errcode='42501',message='TRANSFER_CANCEL_FORBIDDEN'; end if;
 if not app_private.has_branch_access(v_t.source_branch_id)
    and not app_private.has_branch_access(v_t.destination_branch_id)
    and not app_private.has_permission(v_t.organization_id,'branch.manage') then
   raise exception using errcode='42501',message='TRANSFER_CANCEL_BRANCH_FORBIDDEN';
 end if;
 update public.stock_transfers set status='CANCELLED',notes=concat_ws(E'\n',notes,nullif(trim(p_reason),'')) where id=p_transfer_id;
 return p_transfer_id;
end $$;

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
 return v_id;
end $$;
