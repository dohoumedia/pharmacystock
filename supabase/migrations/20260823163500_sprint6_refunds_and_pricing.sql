create or replace function app_private.refund_sale_impl(p_sale_id uuid,p_refund_number text,p_items jsonb,p_idempotency_key text,p_reason text)
returns uuid language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_sale public.sales%rowtype; v_refund_id uuid; v_item jsonb; v_sale_item public.sale_items%rowtype; v_qty numeric(18,4); v_previously_refunded numeric(18,4); v_amount numeric(18,2):=0; v_move uuid; v_total_sold_qty numeric(18,4); v_total_refunded_qty numeric(18,4);
begin
  if auth.uid() is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  select * into v_sale from public.sales where id=p_sale_id for update;
  if not found then raise exception using errcode='P0002',message='SALE_NOT_FOUND'; end if;
  if not app_private.has_branch_access(v_sale.branch_id) or not app_private.has_permission(v_sale.organization_id,'sale.refund') then raise exception using errcode='42501',message='SALE_REFUND_FORBIDDEN'; end if;
  if v_sale.status='VOIDED' then raise exception using errcode='23514',message='SALE_NOT_REFUNDABLE'; end if;
  if nullif(trim(p_refund_number),'') is null or nullif(trim(p_idempotency_key),'') is null or nullif(trim(p_reason),'') is null then raise exception using errcode='23514',message='REFUND_IDENTITY_REQUIRED'; end if;
  select id into v_refund_id from public.sale_refunds where organization_id=v_sale.organization_id and idempotency_key=p_idempotency_key;
  if v_refund_id is not null then return v_refund_id; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then raise exception using errcode='23514',message='REFUND_ITEMS_REQUIRED'; end if;
  insert into public.sale_refunds(organization_id,branch_id,sale_id,refund_number,reason,amount,idempotency_key,created_by) values(v_sale.organization_id,v_sale.branch_id,v_sale.id,trim(p_refund_number),trim(p_reason),0,p_idempotency_key,auth.uid()) returning id into v_refund_id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_sale_item from public.sale_items where id=(v_item->>'sale_item_id')::uuid and sale_id=v_sale.id for update;
    if not found then raise exception using errcode='P0002',message='SALE_ITEM_NOT_FOUND'; end if;
    v_qty=(v_item->>'quantity')::numeric;
    if v_qty<=0 then raise exception using errcode='23514',message='INVALID_REFUND_QUANTITY'; end if;
    select coalesce(sum(ri.quantity),0) into v_previously_refunded from public.sale_refund_items ri join public.sale_refunds r on r.id=ri.refund_id where r.sale_id=v_sale.id and ri.sale_item_id=v_sale_item.id;
    if v_previously_refunded+v_qty>v_sale_item.quantity then raise exception using errcode='23514',message='REFUND_EXCEEDS_SOLD_QUANTITY'; end if;
    v_move:=public.post_inventory_movement(v_sale.organization_id,v_sale.branch_id,v_sale_item.batch_id,'RETURN_IN',v_qty,'refund:'||v_refund_id::text||':'||v_sale_item.id::text,'Customer return','sale_refund',v_refund_id::text,null,jsonb_build_object('sale_id',v_sale.id,'sale_item_id',v_sale_item.id),now());
    insert into public.sale_refund_items(organization_id,refund_id,sale_item_id,batch_id,quantity,amount,inventory_movement_id) values(v_sale.organization_id,v_refund_id,v_sale_item.id,v_sale_item.batch_id,v_qty,round((v_qty*v_sale_item.unit_price)::numeric,2),v_move);
    v_amount:=v_amount+round((v_qty*v_sale_item.unit_price)::numeric,2);
  end loop;
  update public.sale_refunds set amount=v_amount where id=v_refund_id;
  select coalesce(sum(quantity),0) into v_total_sold_qty from public.sale_items where sale_id=v_sale.id;
  select coalesce(sum(ri.quantity),0) into v_total_refunded_qty from public.sale_refund_items ri join public.sale_refunds r on r.id=ri.refund_id where r.sale_id=v_sale.id;
  update public.sales set status=case when v_total_refunded_qty>=v_total_sold_qty then 'REFUNDED' else 'PARTIALLY_REFUNDED' end where id=v_sale.id;
  return v_refund_id;
end $$;
revoke all on function app_private.refund_sale_impl(uuid,text,jsonb,text,text) from public,anon;
grant execute on function app_private.refund_sale_impl(uuid,text,jsonb,text,text) to authenticated;

create or replace function public.refund_sale(p_sale_id uuid,p_refund_number text,p_items jsonb,p_idempotency_key text,p_reason text)
returns uuid language sql security invoker set search_path=public,app_private,pg_temp as $$ select app_private.refund_sale_impl(p_sale_id,p_refund_number,p_items,p_idempotency_key,p_reason); $$;
revoke all on function public.refund_sale(uuid,text,jsonb,text,text) from public,anon;
grant execute on function public.refund_sale(uuid,text,jsonb,text,text) to authenticated;

create index if not exists sale_refund_items_refund_idx on public.sale_refund_items(refund_id);
create index if not exists sale_refund_items_sale_item_idx on public.sale_refund_items(sale_item_id);

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
      if v_price is null or v_price<0 then raise exception using errcode='23514',message='SELLING_PRICE_REQUIRED'; end if;
      v_take:=least(v_remaining,v_batch.available_quantity);
      v_move:=public.post_inventory_movement(p_organization_id,p_branch_id,v_batch.batch_id,'SALE',-v_take,'sale:'||v_sale_id::text||':'||v_batch.batch_id::text||':'||v_product_id::text,'POS sale','sale',v_sale_id::text,null,jsonb_build_object('product_id',v_product_id),now());
      insert into public.sale_items(organization_id,sale_id,product_id,batch_id,quantity,unit_price,inventory_movement_id) values(p_organization_id,v_sale_id,v_product_id,v_batch.batch_id,v_take,v_price,v_move);
      v_subtotal:=v_subtotal+round((v_take*v_price)::numeric,2); v_remaining:=v_remaining-v_take;
    end loop;
    if v_remaining>0 then raise exception using errcode='23514',message='INSUFFICIENT_STOCK'; end if;
  end loop;
  for v_payment in select * from jsonb_array_elements(coalesce(p_payments,'[]'::jsonb)) loop
    insert into public.payments(organization_id,branch_id,sale_id,method,amount,provider,external_reference,created_by) values(p_organization_id,p_branch_id,v_sale_id,upper(v_payment->>'method'),(v_payment->>'amount')::numeric,nullif(v_payment->>'provider',''),nullif(v_payment->>'external_reference',''),auth.uid());
    v_payment_total:=v_payment_total+(v_payment->>'amount')::numeric;
  end loop;
  if v_payment_total<>v_subtotal then raise exception using errcode='23514',message='PAYMENT_TOTAL_MISMATCH'; end if;
  update public.sales set subtotal=v_subtotal,total_amount=v_subtotal where id=v_sale_id; return v_sale_id;
end $$;