-- Record refunds in the append-oriented audit log without changing refund semantics.
create or replace function app_private.refund_sale_impl(
  p_sale_id uuid,
  p_refund_number text,
  p_items jsonb,
  p_idempotency_key text,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path=public,app_private,pg_temp
as $$
declare
  v_sale public.sales%rowtype;
  v_refund_id uuid;
  v_item jsonb;
  v_sale_item public.sale_items%rowtype;
  v_qty numeric(18,4);
  v_previously_refunded numeric(18,4);
  v_amount numeric(18,2):=0;
  v_move uuid;
  v_total_sold_qty numeric(18,4);
  v_total_refunded_qty numeric(18,4);
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='AUTH_REQUIRED';
  end if;

  select * into v_sale
  from public.sales
  where id=p_sale_id
  for update;

  if not found then
    raise exception using errcode='P0002',message='SALE_NOT_FOUND';
  end if;

  if not app_private.has_branch_access(v_sale.branch_id)
    or not app_private.has_permission(v_sale.organization_id,'sale.refund') then
    raise exception using errcode='42501',message='SALE_REFUND_FORBIDDEN';
  end if;

  if v_sale.status='VOIDED' then
    raise exception using errcode='23514',message='SALE_NOT_REFUNDABLE';
  end if;

  if nullif(trim(p_refund_number),'') is null
    or nullif(trim(p_idempotency_key),'') is null
    or nullif(trim(p_reason),'') is null then
    raise exception using errcode='23514',message='REFUND_IDENTITY_REQUIRED';
  end if;

  select id into v_refund_id
  from public.sale_refunds
  where organization_id=v_sale.organization_id
    and idempotency_key=p_idempotency_key;

  if v_refund_id is not null then
    return v_refund_id;
  end if;

  if jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then
    raise exception using errcode='23514',message='REFUND_ITEMS_REQUIRED';
  end if;

  insert into public.sale_refunds(
    organization_id,branch_id,sale_id,refund_number,reason,amount,idempotency_key,created_by
  )
  values(
    v_sale.organization_id,v_sale.branch_id,v_sale.id,trim(p_refund_number),
    trim(p_reason),0,p_idempotency_key,auth.uid()
  )
  returning id into v_refund_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_sale_item
    from public.sale_items
    where id=(v_item->>'sale_item_id')::uuid
      and sale_id=v_sale.id
    for update;

    if not found then
      raise exception using errcode='P0002',message='SALE_ITEM_NOT_FOUND';
    end if;

    v_qty=(v_item->>'quantity')::numeric;

    if v_qty<=0 then
      raise exception using errcode='23514',message='INVALID_REFUND_QUANTITY';
    end if;

    select coalesce(sum(ri.quantity),0)
    into v_previously_refunded
    from public.sale_refund_items ri
    join public.sale_refunds r on r.id=ri.refund_id
    where r.sale_id=v_sale.id
      and ri.sale_item_id=v_sale_item.id;

    if v_previously_refunded+v_qty>v_sale_item.quantity then
      raise exception using errcode='23514',message='REFUND_EXCEEDS_SOLD_QUANTITY';
    end if;

    v_move:=public.post_inventory_movement(
      v_sale.organization_id,
      v_sale.branch_id,
      v_sale_item.batch_id,
      'RETURN_IN',
      v_qty,
      'refund:'||v_refund_id::text||':'||v_sale_item.id::text,
      'Customer return',
      'sale_refund',
      v_refund_id::text,
      null,
      jsonb_build_object('sale_id',v_sale.id,'sale_item_id',v_sale_item.id),
      now()
    );

    insert into public.sale_refund_items(
      organization_id,refund_id,sale_item_id,batch_id,quantity,amount,inventory_movement_id
    )
    values(
      v_sale.organization_id,v_refund_id,v_sale_item.id,v_sale_item.batch_id,
      v_qty,round((v_qty*v_sale_item.unit_price)::numeric,2),v_move
    );

    v_amount:=v_amount+round((v_qty*v_sale_item.unit_price)::numeric,2);
  end loop;

  update public.sale_refunds
  set amount=v_amount
  where id=v_refund_id;

  select coalesce(sum(quantity),0)
  into v_total_sold_qty
  from public.sale_items
  where sale_id=v_sale.id;

  select coalesce(sum(ri.quantity),0)
  into v_total_refunded_qty
  from public.sale_refund_items ri
  join public.sale_refunds r on r.id=ri.refund_id
  where r.sale_id=v_sale.id;

  update public.sales
  set status=case
    when v_total_refunded_qty>=v_total_sold_qty then 'REFUNDED'
    else 'PARTIALLY_REFUNDED'
  end
  where id=v_sale.id;

  insert into public.audit_logs(
    organization_id,branch_id,actor_user_id,event_type,entity_type,entity_id,metadata
  )
  values(
    v_sale.organization_id,
    v_sale.branch_id,
    auth.uid(),
    'sale.refunded',
    'sale_refund',
    v_refund_id::text,
    jsonb_build_object(
      'sale_id',v_sale.id,
      'refund_id',v_refund_id,
      'refund_number',trim(p_refund_number),
      'amount',v_amount,
      'reason',trim(p_reason)
    )
  );

  return v_refund_id;
end;
$$;
