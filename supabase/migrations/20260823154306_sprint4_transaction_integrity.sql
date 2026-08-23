alter table public.purchase_orders add column if not exists idempotency_key text;
alter table public.purchase_receipts add column if not exists idempotency_key text;
create unique index if not exists purchase_orders_org_idempotency_uidx on public.purchase_orders(organization_id,idempotency_key) where idempotency_key is not null;
create unique index if not exists purchase_receipts_org_idempotency_uidx on public.purchase_receipts(organization_id,idempotency_key) where idempotency_key is not null;

drop trigger if exists suppliers_set_updated_at on public.suppliers;
create trigger suppliers_set_updated_at before update on public.suppliers for each row execute function public.set_updated_at();
drop trigger if exists purchase_orders_set_updated_at on public.purchase_orders;
create trigger purchase_orders_set_updated_at before update on public.purchase_orders for each row execute function public.set_updated_at();
drop trigger if exists purchase_order_lines_set_updated_at on public.purchase_order_lines;
create trigger purchase_order_lines_set_updated_at before update on public.purchase_order_lines for each row execute function public.set_updated_at();

drop policy if exists pol_read on public.purchase_order_lines;
create policy pol_read on public.purchase_order_lines for select to authenticated using (
  app_private.has_permission(organization_id,'purchase.read') and exists (
    select 1 from public.purchase_orders po
    where po.id=purchase_order_id and po.organization_id=organization_id and app_private.has_branch_access(po.branch_id)
  )
);
drop policy if exists pol_manage on public.purchase_order_lines;

drop policy if exists receipt_lines_read on public.purchase_receipt_lines;
create policy receipt_lines_read on public.purchase_receipt_lines for select to authenticated using (
  app_private.has_permission(organization_id,'purchase.read') and exists (
    select 1 from public.purchase_receipts pr
    where pr.id=receipt_id and pr.organization_id=organization_id and app_private.has_branch_access(pr.branch_id)
  )
);
drop policy if exists receipt_lines_insert on public.purchase_receipt_lines;
drop policy if exists receipts_insert on public.purchase_receipts;
drop policy if exists po_create on public.purchase_orders;
drop policy if exists po_update on public.purchase_orders;

revoke insert,update,delete on public.purchase_orders, public.purchase_order_lines, public.purchase_receipts, public.purchase_receipt_lines from authenticated;

create or replace function app_private.create_purchase_order_impl(
  p_organization_id uuid,
  p_branch_id uuid,
  p_supplier_id uuid,
  p_po_number text,
  p_expected_at date,
  p_notes text,
  p_lines jsonb,
  p_idempotency_key text
) returns uuid
language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare
  v_order_id uuid;
  v_line jsonb;
  v_product_id uuid;
  v_quantity numeric;
  v_unit_cost numeric;
begin
  if auth.uid() is null then raise exception using errcode='42501', message='AUTH_REQUIRED'; end if;
  if not app_private.is_org_member(p_organization_id) then raise exception using errcode='42501', message='TENANT_ACCESS_DENIED'; end if;
  if not app_private.has_branch_access(p_branch_id) then raise exception using errcode='42501', message='BRANCH_ACCESS_DENIED'; end if;
  if not app_private.has_permission(p_organization_id,'purchase.create') then raise exception using errcode='42501', message='PURCHASE_CREATE_FORBIDDEN'; end if;
  if coalesce(trim(p_po_number),'')='' then raise exception using errcode='23514', message='PURCHASE_ORDER_NUMBER_REQUIRED'; end if;
  if jsonb_typeof(coalesce(p_lines,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_lines,'[]'::jsonb))=0 then raise exception using errcode='23514', message='PURCHASE_ORDER_REQUIRES_LINES'; end if;
  if coalesce(trim(p_idempotency_key),'')='' then raise exception using errcode='23514', message='IDEMPOTENCY_KEY_REQUIRED'; end if;

  select id into v_order_id from public.purchase_orders where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if v_order_id is not null then return v_order_id; end if;

  if not exists(select 1 from public.branches where id=p_branch_id and organization_id=p_organization_id) then raise exception using errcode='23503', message='BRANCH_NOT_FOUND'; end if;
  if not exists(select 1 from public.suppliers where id=p_supplier_id and organization_id=p_organization_id and status='active') then raise exception using errcode='23503', message='SUPPLIER_NOT_FOUND'; end if;

  insert into public.purchase_orders(organization_id,branch_id,supplier_id,po_number,status,ordered_at,expected_at,notes,created_by,idempotency_key)
  values(p_organization_id,p_branch_id,p_supplier_id,trim(p_po_number),'ordered',now(),p_expected_at,nullif(trim(p_notes),''),auth.uid(),p_idempotency_key)
  returning id into v_order_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    begin
      v_product_id := (v_line->>'product_id')::uuid;
      v_quantity := (v_line->>'quantity')::numeric;
      v_unit_cost := nullif(v_line->>'unit_cost','')::numeric;
    exception when others then
      raise exception using errcode='23514', message='INVALID_PURCHASE_ORDER_LINE';
    end;
    if v_quantity is null or v_quantity<=0 then raise exception using errcode='23514', message='INVALID_PURCHASE_ORDER_QUANTITY'; end if;
    if v_unit_cost is not null and v_unit_cost<0 then raise exception using errcode='23514', message='INVALID_PURCHASE_ORDER_COST'; end if;
    if not exists(select 1 from public.products where id=v_product_id and organization_id=p_organization_id and status='active') then raise exception using errcode='23503', message='PRODUCT_NOT_FOUND'; end if;
    insert into public.purchase_order_lines(organization_id,purchase_order_id,product_id,ordered_quantity,unit_cost)
    values(p_organization_id,v_order_id,v_product_id,v_quantity,v_unit_cost);
  end loop;

  insert into public.audit_logs(organization_id,branch_id,actor_user_id,event_type,entity_type,entity_id,metadata)
  values(p_organization_id,p_branch_id,auth.uid(),'purchase.created','purchase_order',v_order_id::text,jsonb_build_object('po_number',trim(p_po_number)));
  return v_order_id;
exception when unique_violation then
  select id into v_order_id from public.purchase_orders where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if v_order_id is not null then return v_order_id; end if;
  raise;
end;
$$;

create or replace function public.create_purchase_order(
  p_organization_id uuid,
  p_branch_id uuid,
  p_supplier_id uuid,
  p_po_number text,
  p_expected_at date default null,
  p_notes text default null,
  p_lines jsonb default '[]'::jsonb,
  p_idempotency_key text default null
) returns uuid
language sql security invoker set search_path=public,app_private,pg_temp as $$
  select app_private.create_purchase_order_impl(p_organization_id,p_branch_id,p_supplier_id,p_po_number,p_expected_at,p_notes,p_lines,p_idempotency_key);
$$;

create or replace function app_private.receive_purchase_order_impl(
  p_purchase_order_id uuid,
  p_receipt_number text,
  p_supplier_invoice_number text,
  p_lines jsonb,
  p_notes text,
  p_idempotency_key text
) returns uuid
language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare
  v_po public.purchase_orders%rowtype;
  v_receipt uuid;
  v_line jsonb;
  v_pol public.purchase_order_lines%rowtype;
  v_batch uuid;
  v_qty numeric;
  v_cost numeric;
  v_movement uuid;
  v_lot text;
  v_expiry date;
begin
  if auth.uid() is null then raise exception using errcode='42501', message='AUTH_REQUIRED'; end if;
  select * into v_po from public.purchase_orders where id=p_purchase_order_id for update;
  if not found then raise exception using errcode='P0002', message='PURCHASE_ORDER_NOT_FOUND'; end if;
  if not app_private.is_org_member(v_po.organization_id) then raise exception using errcode='42501', message='TENANT_ACCESS_DENIED'; end if;
  if not app_private.has_branch_access(v_po.branch_id) then raise exception using errcode='42501', message='BRANCH_ACCESS_DENIED'; end if;
  if not app_private.has_permission(v_po.organization_id,'purchase.receive') then raise exception using errcode='42501', message='PURCHASE_RECEIVE_FORBIDDEN'; end if;
  if v_po.status in ('received','cancelled') then raise exception using errcode='23514', message='PURCHASE_ORDER_NOT_RECEIVABLE'; end if;
  if coalesce(trim(p_receipt_number),'')='' then raise exception using errcode='23514', message='RECEIPT_NUMBER_REQUIRED'; end if;
  if coalesce(trim(p_idempotency_key),'')='' then raise exception using errcode='23514', message='IDEMPOTENCY_KEY_REQUIRED'; end if;
  if jsonb_typeof(coalesce(p_lines,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_lines,'[]'::jsonb))=0 then raise exception using errcode='23514', message='RECEIPT_REQUIRES_LINES'; end if;

  select id into v_receipt from public.purchase_receipts where organization_id=v_po.organization_id and idempotency_key=p_idempotency_key;
  if v_receipt is not null then return v_receipt; end if;

  insert into public.purchase_receipts(organization_id,branch_id,purchase_order_id,receipt_number,supplier_invoice_number,notes,received_by,idempotency_key)
  values(v_po.organization_id,v_po.branch_id,v_po.id,trim(p_receipt_number),nullif(trim(p_supplier_invoice_number),''),nullif(trim(p_notes),''),auth.uid(),p_idempotency_key)
  returning id into v_receipt;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    begin
      select * into v_pol from public.purchase_order_lines where id=(v_line->>'purchase_order_line_id')::uuid and purchase_order_id=v_po.id for update;
      v_qty := (v_line->>'quantity')::numeric;
      v_cost := coalesce(nullif(v_line->>'unit_cost','')::numeric,v_pol.unit_cost);
      v_lot := trim(v_line->>'lot_number');
      v_expiry := (v_line->>'expiry_date')::date;
    exception when others then
      raise exception using errcode='23514', message='INVALID_RECEIPT_LINE';
    end;
    if not found then raise exception using errcode='P0002', message='PURCHASE_ORDER_LINE_NOT_FOUND'; end if;
    if v_qty is null or v_qty<=0 or v_pol.received_quantity+v_qty>v_pol.ordered_quantity then raise exception using errcode='23514', message='INVALID_RECEIPT_QUANTITY'; end if;
    if coalesce(v_lot,'')='' then raise exception using errcode='23514', message='LOT_NUMBER_REQUIRED'; end if;
    if v_cost is not null and v_cost<0 then raise exception using errcode='23514', message='INVALID_RECEIPT_COST'; end if;

    select id into v_batch from public.batches
    where organization_id=v_po.organization_id and branch_id=v_po.branch_id and product_id=v_pol.product_id and lot_number=v_lot and expiry_date=v_expiry limit 1;
    if v_batch is null then
      insert into public.batches(organization_id,branch_id,product_id,lot_number,expiry_date,purchase_cost)
      values(v_po.organization_id,v_po.branch_id,v_pol.product_id,v_lot,v_expiry,v_cost)
      returning id into v_batch;
    end if;

    v_movement := public.post_inventory_movement(
      v_po.organization_id,v_po.branch_id,v_batch,'PURCHASE_RECEIPT',v_qty,
      'purchase-receipt:'||v_receipt::text||':line:'||v_pol.id::text,
      'Purchase receipt','PURCHASE_RECEIPT',v_receipt::text,v_cost,
      jsonb_build_object('purchase_order_id',v_po.id,'purchase_order_line_id',v_pol.id),now()
    );

    insert into public.purchase_receipt_lines(organization_id,receipt_id,purchase_order_line_id,batch_id,quantity,unit_cost,inventory_movement_id)
    values(v_po.organization_id,v_receipt,v_pol.id,v_batch,v_qty,v_cost,v_movement);
    update public.purchase_order_lines set received_quantity=received_quantity+v_qty where id=v_pol.id;
  end loop;

  if not exists(select 1 from public.purchase_order_lines where purchase_order_id=v_po.id and received_quantity<ordered_quantity) then
    update public.purchase_orders set status='received' where id=v_po.id;
  else
    update public.purchase_orders set status='partially_received' where id=v_po.id;
  end if;

  insert into public.audit_logs(organization_id,branch_id,actor_user_id,event_type,entity_type,entity_id,metadata)
  values(v_po.organization_id,v_po.branch_id,auth.uid(),'purchase.received','purchase_receipt',v_receipt::text,jsonb_build_object('purchase_order_id',v_po.id,'receipt_number',trim(p_receipt_number)));
  return v_receipt;
exception when unique_violation then
  select id into v_receipt from public.purchase_receipts where organization_id=v_po.organization_id and idempotency_key=p_idempotency_key;
  if v_receipt is not null then return v_receipt; end if;
  raise;
end;
$$;

create or replace function public.receive_purchase_order(
  p_purchase_order_id uuid,
  p_receipt_number text,
  p_supplier_invoice_number text default null,
  p_lines jsonb default '[]'::jsonb,
  p_notes text default null,
  p_idempotency_key text default null
) returns uuid
language sql security invoker set search_path=public,app_private,pg_temp as $$
  select app_private.receive_purchase_order_impl(p_purchase_order_id,p_receipt_number,p_supplier_invoice_number,p_lines,p_notes,p_idempotency_key);
$$;

revoke all on function app_private.create_purchase_order_impl(uuid,uuid,uuid,text,date,text,jsonb,text) from public,anon;
revoke all on function app_private.receive_purchase_order_impl(uuid,text,text,jsonb,text,text) from public,anon;
grant usage on schema app_private to authenticated;
grant execute on function app_private.create_purchase_order_impl(uuid,uuid,uuid,text,date,text,jsonb,text) to authenticated;
grant execute on function app_private.receive_purchase_order_impl(uuid,text,text,jsonb,text,text) to authenticated;
revoke all on function public.create_purchase_order(uuid,uuid,uuid,text,date,text,jsonb,text) from public,anon;
revoke all on function public.receive_purchase_order(uuid,text,text,jsonb,text,text) from public,anon;
grant execute on function public.create_purchase_order(uuid,uuid,uuid,text,date,text,jsonb,text) to authenticated;
grant execute on function public.receive_purchase_order(uuid,text,text,jsonb,text,text) to authenticated;

drop function if exists public.receive_purchase_order(uuid,text,text,jsonb,text);
