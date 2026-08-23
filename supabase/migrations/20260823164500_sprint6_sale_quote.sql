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
      if v_price is null or v_price<0 then raise exception using errcode='23514',message='SELLING_PRICE_REQUIRED'; end if;
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