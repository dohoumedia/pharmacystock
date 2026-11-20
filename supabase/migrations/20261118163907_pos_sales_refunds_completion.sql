-- Local functional completion. Not applied to any hosted project.
-- Existing sale/refund workers, FEFO and ledger remain authoritative.
alter table public.payments add column tendered_amount numeric(18,2), add column change_amount numeric(18,2);
alter table public.payments add constraint payments_cash_tender_check check (
  (tendered_amount is null and change_amount is null) or
  (method='CASH' and tendered_amount is not null and change_amount is not null and tendered_amount>=amount and change_amount=tendered_amount-amount)
);

-- Extend the existing command with a reviewed quote, leaving its original overload
-- available to the established offline replay transport.
create function app_private.complete_sale_reviewed_impl(
  p_organization_id uuid,p_branch_id uuid,p_sale_number text,p_lines jsonb,p_payments jsonb,
  p_idempotency_key text,p_notes text,p_customer_id uuid,p_expected_quote jsonb,p_cash_tendered numeric
) returns uuid language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_sale uuid; v_expected jsonb; v_actual jsonb; v_due numeric; v_payment uuid;
begin
  if auth.uid() is null or not app_private.is_org_member(p_organization_id) or not app_private.has_permission(p_organization_id,'sale.create') then
    raise exception using errcode='42501',message='SALE_CREATE_FORBIDDEN';
  end if;
  if not app_private.has_branch_access(p_branch_id) or not exists(select 1 from public.branches where id=p_branch_id and organization_id=p_organization_id) then
    raise exception using errcode='42501',message='BRANCH_ACCESS_DENIED';
  end if;
  if nullif(trim(p_idempotency_key),'') is null then raise exception using errcode='23514',message='SALE_IDENTITY_REQUIRED'; end if;
  -- Serialize retries of this identity, including a concurrently dropped response.
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':sale:'||p_idempotency_key,0));
  select id into v_sale from public.sales where organization_id=p_organization_id and branch_id=p_branch_id and idempotency_key=p_idempotency_key;
  if v_sale is not null then return v_sale; end if;
  if exists(select 1 from public.sales where organization_id=p_organization_id and idempotency_key=p_idempotency_key) then raise exception using errcode='23514',message='SALE_IDENTITY_CONFLICT'; end if;
  if p_expected_quote is null or jsonb_typeof(p_expected_quote->'items') is distinct from 'array' then raise exception using errcode='23514',message='SALE_QUOTE_CHANGED'; end if;
  if exists(select 1 from jsonb_array_elements(p_lines) l group by l->>'product_id' having count(*)>1) then raise exception using errcode='23514',message='INVALID_SALE_LINE'; end if;
  -- All mutations below roll back if the actual server allocation differs, including
  -- same-total changes. No stale quote can be turned into a price override.
  v_sale:=app_private.complete_sale_with_customer_impl(p_organization_id,p_branch_id,p_sale_number,p_lines,p_payments,p_idempotency_key,p_notes,p_customer_id);
  select jsonb_agg(jsonb_build_object('product_id',i.product_id,'batch_id',i.batch_id,'quantity',i.quantity,'unit_price',i.unit_price,'line_total',i.line_total,'expiry_date',b.expiry_date) order by i.product_id,i.batch_id)
    into v_actual from public.sale_items i join public.batches b on b.id=i.batch_id where i.sale_id=v_sale;
  select jsonb_agg(jsonb_build_object('product_id',(i->>'product_id')::uuid,'batch_id',(i->>'batch_id')::uuid,'quantity',(i->>'quantity')::numeric,'unit_price',(i->>'unit_price')::numeric,'line_total',(i->>'line_total')::numeric,'expiry_date',(i->>'expiry_date')::date) order by (i->>'product_id')::uuid,(i->>'batch_id')::uuid)
    into v_expected from jsonb_array_elements(p_expected_quote->'items') i;
  select total_amount into v_due from public.sales where id=v_sale;
  if v_actual is distinct from v_expected or v_due is distinct from (p_expected_quote->>'total_amount')::numeric then raise exception using errcode='23514',message='SALE_QUOTE_CHANGED'; end if;
  if p_cash_tendered is not null then
    if (select count(*) from public.payments where sale_id=v_sale)<>1 then raise exception using errcode='23514',message='INVALID_CASH_TENDER'; end if;
    select id into v_payment from public.payments where sale_id=v_sale and method='CASH';
    if v_payment is null or p_cash_tendered<v_due or round(p_cash_tendered,2)<>p_cash_tendered or p_cash_tendered>=1e12 then raise exception using errcode='23514',message='INVALID_CASH_TENDER'; end if;
    update public.payments set tendered_amount=p_cash_tendered,change_amount=p_cash_tendered-v_due where id=v_payment;
  end if;
  update public.sales set currency_code=(select currency_code from public.organizations where id=p_organization_id) where id=v_sale;
  return v_sale;
end $$;
revoke all on function app_private.complete_sale_reviewed_impl(uuid,uuid,text,jsonb,jsonb,text,text,uuid,jsonb,numeric) from public,anon;
grant execute on function app_private.complete_sale_reviewed_impl(uuid,uuid,text,jsonb,jsonb,text,text,uuid,jsonb,numeric) to authenticated;
create function public.complete_sale_with_customer(
  p_organization_id uuid,p_branch_id uuid,p_sale_number text,p_lines jsonb,p_payments jsonb,
  p_idempotency_key text,p_notes text,p_customer_id uuid,p_expected_quote jsonb,p_cash_tendered numeric
) returns uuid language sql security invoker set search_path=public,app_private,pg_temp as $$
  select app_private.complete_sale_reviewed_impl(p_organization_id,p_branch_id,p_sale_number,p_lines,p_payments,p_idempotency_key,p_notes,p_customer_id,p_expected_quote,p_cash_tendered);
$$;
revoke all on function public.complete_sale_with_customer(uuid,uuid,text,jsonb,jsonb,text,text,uuid,jsonb,numeric) from public,anon;
grant execute on function public.complete_sale_with_customer(uuid,uuid,text,jsonb,jsonb,text,text,uuid,jsonb,numeric) to authenticated;
