-- Backward-compatible foundation for batch-owned selling prices.
--
-- Rollout note: existing clients may continue omitting p_lines[].selling_price.
-- A later UI rollout can make the value mandatory without changing the RPC signature.
-- NULL remains a representable legacy/unpriced state, but quote and checkout reject it.

do $$
declare
  v_invalid_count bigint;
begin
  -- Keep the compatibility preflight and constraint replacement atomic. The lock
  -- prevents a concurrent zero/negative write between the audit and new check.
  execute 'lock table public.batches in share row exclusive mode';

  select count(*) into v_invalid_count
  from public.batches
  where selling_price is not null and selling_price <= 0;

  if v_invalid_count > 0 then
    raise exception using
      errcode = '23514',
      message = 'BATCH_SELLING_PRICE_REMEDIATION_REQUIRED',
      detail = format('%s batch row(s) have a zero or negative selling price; remediate them before applying this migration.', v_invalid_count);
  end if;

  execute 'alter table public.batches drop constraint if exists batches_price_nonnegative';
  execute 'alter table public.batches drop constraint if exists batches_price_positive_when_set';
  execute 'alter table public.batches add constraint batches_price_positive_when_set check (selling_price is null or selling_price > 0)';
end;
$$;

comment on constraint batches_price_positive_when_set on public.batches is
  'Batch selling price may be unset for legacy/preparation states; when set it must be positive.';

create or replace function app_private.require_positive_selling_price(p_selling_price numeric)
returns numeric
language plpgsql
immutable
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_selling_price is null or p_selling_price <= 0 then
    raise exception using errcode = '23514', message = 'SELLING_PRICE_REQUIRED';
  end if;
  return p_selling_price;
end;
$$;

revoke all on function app_private.require_positive_selling_price(numeric) from public, anon, authenticated;
grant execute on function app_private.require_positive_selling_price(numeric) to authenticated;

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
  v_selling_price numeric;
  v_existing_selling_price numeric;
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

  -- A replay of an already accepted request must return its original receipt even
  -- after the purchase order reached the received state.
  select id into v_receipt from public.purchase_receipts where organization_id=v_po.organization_id and idempotency_key=p_idempotency_key;
  if v_receipt is not null then return v_receipt; end if;

  if v_po.status in ('received','cancelled') then raise exception using errcode='23514', message='PURCHASE_ORDER_NOT_RECEIVABLE'; end if;
  if coalesce(trim(p_receipt_number),'')='' then raise exception using errcode='23514', message='RECEIPT_NUMBER_REQUIRED'; end if;
  if coalesce(trim(p_idempotency_key),'')='' then raise exception using errcode='23514', message='IDEMPOTENCY_KEY_REQUIRED'; end if;
  if jsonb_typeof(coalesce(p_lines,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_lines,'[]'::jsonb))=0 then raise exception using errcode='23514', message='RECEIPT_REQUIRES_LINES'; end if;

  insert into public.purchase_receipts(organization_id,branch_id,purchase_order_id,receipt_number,supplier_invoice_number,notes,received_by,idempotency_key)
  values(v_po.organization_id,v_po.branch_id,v_po.id,trim(p_receipt_number),nullif(trim(p_supplier_invoice_number),''),nullif(trim(p_notes),''),auth.uid(),p_idempotency_key)
  returning id into v_receipt;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    begin
      select * into v_pol from public.purchase_order_lines where id=(v_line->>'purchase_order_line_id')::uuid and purchase_order_id=v_po.id for update;
      v_qty := (v_line->>'quantity')::numeric;
      v_cost := coalesce(nullif(v_line->>'unit_cost','')::numeric,v_pol.unit_cost);
      v_selling_price := nullif(trim(v_line->>'selling_price'),'')::numeric;
      v_lot := trim(v_line->>'lot_number');
      v_expiry := (v_line->>'expiry_date')::date;
    exception when others then
      raise exception using errcode='23514', message='INVALID_RECEIPT_LINE';
    end;
    if not found then raise exception using errcode='P0002', message='PURCHASE_ORDER_LINE_NOT_FOUND'; end if;
    if v_qty is null or v_qty<=0 or v_pol.received_quantity+v_qty>v_pol.ordered_quantity then raise exception using errcode='23514', message='INVALID_RECEIPT_QUANTITY'; end if;
    if coalesce(v_lot,'')='' then raise exception using errcode='23514', message='LOT_NUMBER_REQUIRED'; end if;
    if v_cost is not null and v_cost<0 then raise exception using errcode='23514', message='INVALID_RECEIPT_COST'; end if;
    if v_selling_price is not null and v_selling_price<=0 then raise exception using errcode='23514', message='INVALID_BATCH_SELLING_PRICE'; end if;

    select id,selling_price into v_batch,v_existing_selling_price from public.batches
    where organization_id=v_po.organization_id and branch_id=v_po.branch_id and product_id=v_pol.product_id and lot_number=v_lot and expiry_date=v_expiry
    limit 1 for update;
    if v_batch is null then
      insert into public.batches(organization_id,branch_id,product_id,lot_number,expiry_date,purchase_cost,selling_price)
      values(v_po.organization_id,v_po.branch_id,v_pol.product_id,v_lot,v_expiry,v_cost,v_selling_price)
      returning id into v_batch;
    elsif v_selling_price is not null then
      if v_existing_selling_price is null then
        update public.batches set selling_price=v_selling_price where id=v_batch;
      elsif v_existing_selling_price<>v_selling_price then
        raise exception using errcode='23514', message='BATCH_SELLING_PRICE_MISMATCH';
      end if;
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

revoke all on function app_private.receive_purchase_order_impl(uuid,text,text,jsonb,text,text) from public,anon;
grant execute on function app_private.receive_purchase_order_impl(uuid,text,text,jsonb,text,text) to authenticated;

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

revoke all on function public.receive_purchase_order(uuid,text,text,jsonb,text,text) from public,anon;
grant execute on function public.receive_purchase_order(uuid,text,text,jsonb,text,text) to authenticated;

create or replace function public.quote_sale(p_organization_id uuid,p_branch_id uuid,p_lines jsonb)
returns jsonb language plpgsql stable security invoker set search_path=public,app_private,pg_temp as $$
declare v_line jsonb; v_product_id uuid; v_requested numeric(18,4); v_remaining numeric(18,4); v_take numeric(18,4); v_price numeric(18,2); v_batch record; v_total numeric(18,2):=0; v_items jsonb:='[]'::jsonb;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if not app_private.is_org_member(p_organization_id) or not app_private.has_permission(p_organization_id,'sale.create') then raise exception using errcode='42501',message='SALE_CREATE_FORBIDDEN'; end if;
  if not app_private.has_branch_access(p_branch_id) then raise exception using errcode='42501',message='BRANCH_ACCESS_DENIED'; end if;
  if jsonb_array_length(coalesce(p_lines,'[]'::jsonb))=0 then raise exception using errcode='23514',message='SALE_LINES_REQUIRED'; end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_product_id=(v_line->>'product_id')::uuid; v_requested=(v_line->>'quantity')::numeric;
    if v_requested<=0 then raise exception using errcode='23514',message='INVALID_SALE_LINE'; end if;
    v_remaining:=v_requested;
    for v_batch in select * from public.get_fefo_batches(p_organization_id,p_branch_id,v_product_id) loop
      exit when v_remaining<=0;
      select selling_price into v_price from public.batches where id=v_batch.batch_id and organization_id=p_organization_id;
      v_price:=app_private.require_positive_selling_price(v_price);
      v_take:=least(v_remaining,v_batch.available_quantity);
      v_total:=v_total+round((v_take*v_price)::numeric,2);
      v_items:=v_items||jsonb_build_array(jsonb_build_object('product_id',v_product_id,'batch_id',v_batch.batch_id,'quantity',v_take,'unit_price',v_price,'line_total',round((v_take*v_price)::numeric,2),'expiry_date',v_batch.expiry_date));
      v_remaining:=v_remaining-v_take;
    end loop;
    if v_remaining>0 then raise exception using errcode='23514',message='INSUFFICIENT_STOCK'; end if;
  end loop;
  return jsonb_build_object('total_amount',v_total,'items',v_items);
end $$;

revoke all on function public.quote_sale(uuid,uuid,jsonb) from public,anon;
grant execute on function public.quote_sale(uuid,uuid,jsonb) to authenticated;

create or replace function app_private.complete_sale_impl(p_organization_id uuid,p_branch_id uuid,p_sale_number text,p_lines jsonb,p_payments jsonb,p_idempotency_key text,p_notes text default null)
returns uuid language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_sale_id uuid; v_line jsonb; v_payment jsonb; v_product_id uuid; v_requested numeric(18,4); v_remaining numeric(18,4); v_take numeric(18,4); v_price numeric(18,2); v_batch record; v_move uuid; v_subtotal numeric(18,2):=0; v_payment_total numeric(18,2):=0;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if not app_private.is_org_member(p_organization_id) or not app_private.has_permission(p_organization_id,'sale.create') then raise exception using errcode='42501',message='SALE_CREATE_FORBIDDEN'; end if;
  if not app_private.has_branch_access(p_branch_id) then raise exception using errcode='42501',message='BRANCH_ACCESS_DENIED'; end if;
  if nullif(trim(p_sale_number),'') is null or nullif(trim(p_idempotency_key),'') is null then raise exception using errcode='23514',message='SALE_IDENTITY_REQUIRED'; end if;
  select id into v_sale_id from public.sales where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if v_sale_id is not null then return v_sale_id; end if;
  insert into public.sales(organization_id,branch_id,sale_number,idempotency_key,notes,created_by) values(p_organization_id,p_branch_id,trim(p_sale_number),p_idempotency_key,p_notes,auth.uid()) returning id into v_sale_id;
  if jsonb_array_length(coalesce(p_lines,'[]'::jsonb))=0 then raise exception using errcode='23514',message='SALE_LINES_REQUIRED'; end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_product_id=(v_line->>'product_id')::uuid; v_requested=(v_line->>'quantity')::numeric;
    if v_requested<=0 then raise exception using errcode='23514',message='INVALID_SALE_LINE'; end if;
    v_remaining:=v_requested;
    for v_batch in select * from public.get_fefo_batches(p_organization_id,p_branch_id,v_product_id) loop
      exit when v_remaining<=0;
      select b.selling_price into v_price from public.batches b where b.id=v_batch.batch_id and b.organization_id=p_organization_id;
      v_price:=app_private.require_positive_selling_price(v_price);
      v_take:=least(v_remaining,v_batch.available_quantity);
      v_move:=public.post_inventory_movement(p_organization_id,p_branch_id,v_batch.batch_id,'SALE',-v_take,'sale:'||v_sale_id::text||':'||v_batch.batch_id::text||':'||v_product_id::text,'POS sale','sale',v_sale_id::text,null,jsonb_build_object('product_id',v_product_id),now());
      insert into public.sale_items(organization_id,sale_id,product_id,batch_id,quantity,unit_price,inventory_movement_id) values(p_organization_id,v_sale_id,v_product_id,v_batch.batch_id,v_take,v_price,v_move);
      v_subtotal:=v_subtotal+round((v_take*v_price)::numeric,2);
      v_remaining:=v_remaining-v_take;
    end loop;
    if v_remaining>0 then raise exception using errcode='23514',message='INSUFFICIENT_STOCK'; end if;
  end loop;
  for v_payment in select * from jsonb_array_elements(coalesce(p_payments,'[]'::jsonb)) loop
    insert into public.payments(organization_id,branch_id,sale_id,method,amount,provider,external_reference,created_by) values(p_organization_id,p_branch_id,v_sale_id,upper(v_payment->>'method'),(v_payment->>'amount')::numeric,nullif(v_payment->>'provider',''),nullif(v_payment->>'external_reference',''),auth.uid());
    v_payment_total:=v_payment_total+(v_payment->>'amount')::numeric;
  end loop;
  if v_payment_total<>v_subtotal then raise exception using errcode='23514',message='PAYMENT_TOTAL_MISMATCH'; end if;
  update public.sales set subtotal=v_subtotal,total_amount=v_subtotal where id=v_sale_id;
  return v_sale_id;
end $$;

revoke all on function app_private.complete_sale_impl(uuid,uuid,text,jsonb,jsonb,text,text) from public,anon;
grant execute on function app_private.complete_sale_impl(uuid,uuid,text,jsonb,jsonb,text,text) to authenticated;

create or replace function public.complete_sale(p_organization_id uuid,p_branch_id uuid,p_sale_number text,p_lines jsonb,p_payments jsonb,p_idempotency_key text,p_notes text default null)
returns uuid language sql security invoker set search_path=public,app_private,pg_temp as $$
  select app_private.complete_sale_impl(p_organization_id,p_branch_id,p_sale_number,p_lines,p_payments,p_idempotency_key,p_notes);
$$;

revoke all on function public.complete_sale(uuid,uuid,text,jsonb,jsonb,text,text) from public,anon;
grant execute on function public.complete_sale(uuid,uuid,text,jsonb,jsonb,text,text) to authenticated;
