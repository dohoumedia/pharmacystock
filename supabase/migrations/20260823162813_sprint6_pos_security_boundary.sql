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