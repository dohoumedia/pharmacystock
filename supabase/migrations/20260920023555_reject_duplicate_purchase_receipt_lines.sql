-- Reject duplicate purchase-order line identifiers before receiving writes begin.
--
-- The inventory movement idempotency key is scoped to one receipt and one PO line.
-- Without this guard, repeating a PO line inside the same payload could reuse the
-- first movement while still creating another receipt line and incrementing the
-- PO line's received quantity a second time.
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

  -- Validate duplicate identifiers before the replay check and before inserting
  -- any receipt, batch, movement, line, status, quantity, or audit row. Casting to
  -- uuid canonicalizes equivalent textual UUID forms before grouping.
  if jsonb_typeof(coalesce(p_lines,'[]'::jsonb)) = 'array'
    and jsonb_array_length(coalesce(p_lines,'[]'::jsonb)) > 0 then
    begin
      if exists (
        select 1
        from jsonb_array_elements(p_lines) as receipt_line
        where nullif(trim(receipt_line->>'purchase_order_line_id'),'') is not null
        group by (receipt_line->>'purchase_order_line_id')::uuid
        having count(*) > 1
      ) then
        raise exception using errcode='23514', message='DUPLICATE_PURCHASE_ORDER_LINE';
      end if;
    exception when invalid_text_representation then
      raise exception using errcode='23514', message='INVALID_RECEIPT_LINE';
    end;
  end if;

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
