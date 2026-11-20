-- PRD-006 / ORG-FR-005. Read-only, RLS-invoking reports over existing records.
-- Existing daily sales read-model columns are retained; transaction workers and ledger semantics are unchanged.
create function public.read_operational_report(
  p_organization_id uuid, p_branch_id uuid, p_report text,
  p_start date, p_end date, p_search text default '', p_state text default '',
  p_supplier text default '', p_days integer default 30, p_page integer default 0, p_product_id uuid default null
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  v_zone text; v_start timestamptz; v_end timestamptz; v_today date;
  v_result jsonb; v_finance boolean; v_threshold numeric; v_size constant integer:=25;
begin
  if auth.uid() is null or not app_private.is_org_member(p_organization_id)
    or not app_private.has_branch_access(p_branch_id)
    or not app_private.has_permission(p_organization_id,'reports.read') then
    raise exception using errcode='42501',message='REPORT_FORBIDDEN';
  end if;
  select coalesce(nullif(b.timezone,''),o.timezone) into v_zone
    from public.branches b join public.organizations o on o.id=b.organization_id
    where b.id=p_branch_id and b.organization_id=p_organization_id;
  if v_zone is null then raise exception using errcode='42501',message='REPORT_BRANCH_UNAVAILABLE'; end if;
  if p_start is null or p_end is null or p_start>p_end or p_page is null or p_page<0 or p_page>1000000
    or p_days is null or p_days<0 or p_days>3650 or p_report is null
    or p_search is null or p_state is null or p_supplier is null
    or length(p_search)>200 or length(p_supplier)>200 or length(p_state)>60 then
    raise exception using errcode='22023',message='REPORT_FILTER_INVALID';
  end if;
  v_start:=p_start::timestamp at time zone v_zone;
  v_end:=(p_end+1)::timestamp at time zone v_zone;
  v_today:=(statement_timestamp() at time zone v_zone)::date;
  v_finance:=app_private.has_permission(p_organization_id,'reports.finance.read');
  if p_report in ('sales','refunds','payments') and
    (not v_finance or not app_private.has_permission(p_organization_id,'sale.read')) then
    raise exception using errcode='42501',message='REPORT_FINANCE_FORBIDDEN';
  end if;
  if p_report='purchasing' and (not v_finance or not app_private.has_permission(p_organization_id,'purchase.read')) then
    raise exception using errcode='42501',message='REPORT_PURCHASE_FORBIDDEN';
  end if;
  if p_report='transfers' and not app_private.has_permission(p_organization_id,'transfer.read') then
    raise exception using errcode='42501',message='REPORT_TRANSFER_FORBIDDEN';
  end if;
  if p_report in ('inventory','attention','expiry','movements','counts') and not app_private.has_permission(p_organization_id,'inventory.read') then
    raise exception using errcode='42501',message='REPORT_INVENTORY_FORBIDDEN';
  end if;
  if p_report in ('sales','refunds','payments') then
    -- Refunds belong to their own recorded period, including refunds of earlier sales.
    -- Original recorded payments remain unchanged; refund tender is not represented.
    with s as materialized (
      select s.* from public.sales s where s.organization_id=p_organization_id and s.branch_id=p_branch_id
        and s.status<>'VOIDED' and s.completed_at>=v_start and s.completed_at<v_end
    ), r as materialized (
      select r.*,s.sale_number,s.currency_code from public.sale_refunds r join public.sales s on s.id=r.sale_id and s.organization_id=r.organization_id
      where r.organization_id=p_organization_id and r.branch_id=p_branch_id and r.created_at>=v_start and r.created_at<v_end
    ), pay as materialized (
      select p.*,s.sale_number,s.currency_code from public.payments p join public.sales s on s.id=p.sale_id and s.organization_id=p.organization_id
      where p.organization_id=p_organization_id and p.branch_id=p_branch_id and p.created_at>=v_start and p.created_at<v_end
    ), currencies as (
      select currency_code from s union select currency_code from r union select currency_code from pay
    ), methods as (
      select method,count(*) as transaction_count,coalesce(sum(amount) filter(where status='RECORDED'),0) as amount,
        count(*) filter(where status='REVERSED') as reversed_count
      from pay group by method
    ), units as (
      select p.stock_unit,sum(i.quantity) as quantity from s join public.sale_items i on i.sale_id=s.id and i.organization_id=s.organization_id
      join public.products p on p.id=i.product_id and p.organization_id=i.organization_id group by p.stock_unit
    ), data as (
      select s.id,s.id as sale_id,s.sale_number as reference,s.sale_number,s.completed_at as timestamp,s.status,s.total_amount as amount,s.currency_code,
        null::text as method,null::text as reason,null::text as external_reference from s where p_report='sales'
      union all
      select r.id,r.sale_id,r.refund_number,r.sale_number,r.created_at,'REFUND',r.amount,r.currency_code,null,r.reason,null from r where p_report='refunds'
      union all
      select pay.id,pay.sale_id,pay.id::text,pay.sale_number,pay.created_at,pay.status,pay.amount,pay.currency_code,pay.method,null,pay.external_reference from pay where p_report='payments'
    ), filtered as (
      select * from data where (p_search='' or strpos(lower(reference||' '||sale_number),lower(p_search))>0)
        and (p_state='' or status=p_state or method=p_state)
    )
    select jsonb_build_object('summary',jsonb_build_object(
      'gross',case when (select count(*) from currencies)<=1 then (select coalesce(sum(total_amount),0) from s) end,
      'refunds',case when (select count(*) from currencies)<=1 then (select coalesce(sum(amount),0) from r) end,
      'net',case when (select count(*) from currencies)<=1 then (select coalesce(sum(total_amount),0) from s)-(select coalesce(sum(amount),0) from r) end,
      'missing_sale_items',(select count(*) from s where not exists(select 1 from public.sale_items i where i.sale_id=s.id and i.organization_id=s.organization_id)),
      'sale_count',(select count(*) from s),'refund_count',(select count(*) from r),
      'average',case when (select count(*) from currencies)<=1 then (select avg(total_amount) from s) end,
      'recorded_payments',case when (select count(*) from currencies)<=1 then (select coalesce(sum(amount),0) from pay where status='RECORDED') end,
      'payment_difference',case when (select count(*) from currencies)<=1 then (select coalesce(sum(amount),0) from pay where status='RECORDED')-(select coalesce(sum(total_amount),0) from s) end,
      'mixed_currency',(select count(*) from currencies)>1,
      'currency_code',(select min(currency_code) from currencies),
      'methods',case when (select count(*) from currencies)<=1 then coalesce((select jsonb_agg(to_jsonb(methods) order by method) from methods),'[]'::jsonb) else '[]'::jsonb end,
      'units',coalesce((select jsonb_agg(to_jsonb(units) order by stock_unit) from units),'[]'::jsonb)),
      'total',(select count(*) from filtered),
      'rows',coalesce((select jsonb_agg(to_jsonb(page) order by timestamp desc,id) from
        (select * from filtered order by timestamp desc,id limit v_size offset p_page*v_size) page),'[]'::jsonb)) into v_result;
  elsif p_report in ('inventory','expiry','attention') then
    select low_stock_default_threshold into v_threshold from public.organization_settings where organization_id=p_organization_id;
    with stock as materialized (
      select b.id,b.product_id,p.name as product,p.stock_unit,b.lot_number,b.expiry_date,b.status,
        ib.on_hand_quantity as on_hand,ib.reserved_quantity as reserved,ib.available_quantity as available,
        (ib.batch_id is null) as missing_balance,
        case when v_finance then b.purchase_cost end as purchase_cost,
        case when v_finance then b.selling_price end as selling_price,
        case when b.status='ACTIVE' and b.expiry_date>=v_today and b.selling_price is not null then ib.available_quantity else 0 end as sellable,
        case when b.expiry_date<v_today then 'expired' when b.expiry_date<=v_today+p_days then 'near' else 'normal' end as risk,
        case when v_finance then ib.on_hand_quantity*b.purchase_cost end as cost_value,
        case when v_finance then ib.on_hand_quantity*b.selling_price end as retail_value
      from public.batches b join public.products p on p.id=b.product_id and p.organization_id=b.organization_id
      left join public.inventory_balances ib on ib.batch_id=b.id and ib.organization_id=b.organization_id and ib.branch_id=b.branch_id
      where b.organization_id=p_organization_id and b.branch_id=p_branch_id and (p_product_id is null or b.product_id=p_product_id)
        and (p_search='' or strpos(lower(p.name||' '||coalesce(p.sku,'')||' '||b.lot_number),lower(p_search))>0)
    ), products as (
      select p.id,p.name as product,p.stock_unit,
        case when bool_or(s.missing_balance) then null else coalesce(sum(s.on_hand),0) end as on_hand,
        case when bool_or(s.missing_balance) then null else coalesce(sum(s.sellable),0) end as sellable,
        count(s.id) as batches,coalesce(bool_or(s.missing_balance),false) as missing_balance
      from public.products p left join stock s on s.product_id=p.id
      where p.organization_id=p_organization_id and p.status='active' and (p_product_id is null or p.id=p_product_id)
        and (p_search='' or strpos(lower(p.name||' '||coalesce(p.sku,'')),lower(p_search))>0)
      group by p.id,p.name,p.stock_unit
    ), attention as (
      select *,case when missing_balance then 'unknown' when on_hand=0 then 'out'
        when sellable=0 then 'no_sellable' when v_threshold is null then 'unknown'
        when sellable<=v_threshold then 'low' else 'ok' end as attention from products
    ), data as (
      select to_jsonb(s) as row,s.id,s.product from stock s where p_report in ('inventory','expiry')
        and (p_state='' or s.status=p_state or s.risk=p_state)
        and (p_report<>'expiry' or ((s.on_hand>0 or s.missing_balance) and s.risk in ('expired','near')))
      union all
      select to_jsonb(a),a.id,a.product from attention a where p_report='attention' and a.attention<>'ok'
        and (p_state='' or a.attention=p_state)
    ), values as (
      select s.* from stock s join data d on d.id=s.id where p_report<>'attention'
    )
    select jsonb_build_object('summary',jsonb_build_object(
      'batches',(select count(*) from values),
      'cost_value',case when v_finance and not exists(select 1 from values where missing_balance or (on_hand>0 and purchase_cost is null)) then (select coalesce(sum(cost_value),0) from values) end,
      'retail_value',case when v_finance and not exists(select 1 from values where missing_balance or (on_hand>0 and selling_price is null)) then (select coalesce(sum(retail_value),0) from values) end,
      'missing_cost',(select count(*) from values where on_hand>0 and purchase_cost is null),
      'missing_price',(select count(*) from values where on_hand>0 and selling_price is null),
      'missing_balance',case when p_report='attention' then (select count(*) from stock where missing_balance) else (select count(*) from values where missing_balance) end,
      'low',(select count(*) from attention where attention='low'),
      'out',(select count(*) from attention where attention='out'),
      'no_sellable',(select count(*) from attention where attention='no_sellable'),
      'unknown',(select count(*) from attention where attention='unknown'),
      'threshold',v_threshold,'finance',v_finance),
      'total',(select count(*) from data),
      'rows',coalesce((select jsonb_agg(row order by product,id) from
        (select * from data order by product,id limit v_size offset p_page*v_size) page),'[]'::jsonb)) into v_result;
  elsif p_report='purchasing' then
    -- Period selects PO creation date. Received value is actual receipt-line cost to date,
    -- not received quantity multiplied by a possibly different order estimate.
    with data as materialized (
      select o.id,o.po_number as reference,o.created_at as timestamp,o.status,s.name as supplier,
        l.ordered_value,rc.received_value,
        case when o.status='cancelled' then 0 else l.outstanding_value end as outstanding_value,
        l.missing_cost,rc.missing_received_cost
      from public.purchase_orders o join public.suppliers s on s.id=o.supplier_id and s.organization_id=o.organization_id
      cross join lateral (
        select case when count(*)=0 or count(*) filter(where unit_cost is null)>0 then null else sum(ordered_quantity*unit_cost) end as ordered_value,
          case when count(*)=0 or count(*) filter(where ordered_quantity>received_quantity and unit_cost is null)>0 then null
            else coalesce(sum(greatest(ordered_quantity-received_quantity,0)*unit_cost),0) end as outstanding_value,
          count(*) filter(where unit_cost is null) as missing_cost
        from public.purchase_order_lines where purchase_order_id=o.id and organization_id=o.organization_id
      ) l
      cross join lateral (
        select case when count(*) filter(where rl.unit_cost is null)>0 then null else coalesce(sum(rl.quantity*rl.unit_cost),0) end as received_value,
          count(*) filter(where rl.unit_cost is null) as missing_received_cost
        from public.purchase_receipts r join public.purchase_receipt_lines rl on rl.receipt_id=r.id and rl.organization_id=r.organization_id
        where r.purchase_order_id=o.id and r.organization_id=o.organization_id
      ) rc
      where o.organization_id=p_organization_id and o.branch_id=p_branch_id and o.created_at>=v_start and o.created_at<v_end
        and (p_state='' or o.status=p_state) and (p_search='' or strpos(lower(o.po_number),lower(p_search))>0)
        and (p_supplier='' or strpos(lower(s.name),lower(p_supplier))>0)
    )
    select jsonb_build_object('summary',jsonb_build_object(
      'po_count',count(*),'open',count(*) filter(where status='ordered'),'draft',count(*) filter(where status='draft'),
      'partial',count(*) filter(where status='partially_received'),'received',count(*) filter(where status='received'),'cancelled',count(*) filter(where status='cancelled'),
      'ordered_value',case when count(*) filter(where ordered_value is null)=0 then coalesce(sum(ordered_value),0) end,
      'received_value',case when count(*) filter(where received_value is null)=0 then coalesce(sum(received_value),0) end,
      'outstanding_value',case when count(*) filter(where outstanding_value is null)=0 then coalesce(sum(outstanding_value),0) end,
      'missing_cost',coalesce(sum(missing_cost+missing_received_cost),0)),
      'total',count(*),'rows',coalesce((select jsonb_agg(to_jsonb(page) order by timestamp desc,id) from
        (select * from data order by timestamp desc,id limit v_size offset p_page*v_size) page),'[]'::jsonb)) into v_result from data;
  elsif p_report='movements' then
    with data as materialized (
      select m.id,m.occurred_at as timestamp,p.name as product,p.stock_unit,b.lot_number,m.batch_id,
        m.movement_type,m.quantity_delta,m.reason,m.reference_type,m.reference_id,m.reference_type as source,
        case when v_finance then m.unit_cost end as unit_cost
      from public.inventory_movements m join public.batches b on b.id=m.batch_id and b.organization_id=m.organization_id
      join public.products p on p.id=b.product_id and p.organization_id=b.organization_id
      where m.organization_id=p_organization_id and m.branch_id=p_branch_id and m.occurred_at>=v_start and m.occurred_at<v_end
        and (p_state='' or m.movement_type=p_state) and (p_search='' or strpos(lower(p.name||' '||coalesce(p.sku,'')||' '||b.lot_number||' '||coalesce(m.reference_id,'')),lower(p_search))>0)
    ) select jsonb_build_object('summary',jsonb_build_object('movement_count',count(*)),
      'total',count(*),'rows',coalesce((select jsonb_agg(to_jsonb(page) order by timestamp desc,id) from
        (select * from data order by timestamp desc,id limit v_size offset p_page*v_size) page),'[]'::jsonb)) into v_result from data;
  elsif p_report='counts' then
    with data as materialized (
      select c.id,c.id::text as reference,c.created_at as timestamp,c.counted_at,c.status,c.notes,
        (select count(*) from public.inventory_stock_count_lines l where l.stock_count_id=c.id and l.organization_id=c.organization_id) as lines
      from public.inventory_stock_counts c where c.organization_id=p_organization_id and c.branch_id=p_branch_id
        and c.created_at>=v_start and c.created_at<v_end and (p_state='' or c.status=p_state)
        and (p_search='' or strpos(lower(c.id::text||' '||coalesce(c.notes,'')),lower(p_search))>0)
    ) select jsonb_build_object('summary',jsonb_build_object('count_count',count(*),'pending',count(*) filter(where status='OPEN')),
      'total',count(*),'rows',coalesce((select jsonb_agg(to_jsonb(page) order by timestamp desc,id) from
        (select * from data order by timestamp desc,id limit v_size offset p_page*v_size) page),'[]'::jsonb)) into v_result from data;
  elsif p_report='transfers' then
    with data as materialized (
      select x.id,x.transfer_number as reference,x.requested_at as timestamp,x.status,x.source_branch_id,x.destination_branch_id,
        l.lines,l.discrepancy_lines
      from public.stock_transfers x cross join lateral (
        select count(*) as lines,count(*) filter(where discrepancy_quantity<>0) as discrepancy_lines
        from public.stock_transfer_lines where transfer_id=x.id and organization_id=x.organization_id
      ) l where x.organization_id=p_organization_id and (x.source_branch_id=p_branch_id or x.destination_branch_id=p_branch_id)
        and x.requested_at>=v_start and x.requested_at<v_end and (p_state='' or x.status=p_state)
        and (p_search='' or strpos(lower(x.transfer_number),lower(p_search))>0)
    ) select jsonb_build_object('summary',jsonb_build_object('transfer_count',count(*),
      'pending',count(*) filter(where status in ('REQUESTED','APPROVED','DISPATCHED')),
      'discrepancies',count(*) filter(where status='RECEIVED_WITH_DISCREPANCY')),
      'total',count(*),'rows',coalesce((select jsonb_agg(to_jsonb(page) order by timestamp desc,id) from
        (select * from data order by timestamp desc,id limit v_size offset p_page*v_size) page),'[]'::jsonb)) into v_result from data;
  else raise exception using errcode='22023',message='REPORT_KIND_INVALID';
  end if;
  return v_result||jsonb_build_object('timezone',v_zone,'business_date',v_today,'generated_at',statement_timestamp(),
    'start',p_start,'end',p_end,'branch_id',p_branch_id,'page',p_page,'page_size',v_size);
end $$;
revoke all on function public.read_operational_report(uuid,uuid,text,date,date,text,text,text,integer,integer,uuid) from public,anon;
grant execute on function public.read_operational_report(uuid,uuid,text,date,date,text,text,text,integer,integer,uuid) to authenticated;

-- Filtered period scans; preserve existing indexes and write paths.
create index if not exists reports_sales_period_idx on public.sales(organization_id,branch_id,completed_at,id);
create index if not exists reports_refunds_period_idx on public.sale_refunds(organization_id,branch_id,created_at,id);
create index if not exists reports_payments_period_idx on public.payments(organization_id,branch_id,created_at,id);
create index if not exists reports_movements_period_idx on public.inventory_movements(organization_id,branch_id,occurred_at,id);

-- Keep Home's existing daily read model on the same business calendar as closeout.
create or replace view public.report_daily_sales with (security_invoker=true) as
select s.organization_id,s.branch_id,
  (s.completed_at at time zone coalesce(nullif(b.timezone,''),o.timezone))::date as sale_date,
  count(*) filter(where s.status<>'VOIDED')::bigint as sale_count,
  coalesce(sum(s.total_amount) filter(where s.status<>'VOIDED'),0)::numeric(18,2) as gross_sales
from public.sales s join public.branches b on b.id=s.branch_id and b.organization_id=s.organization_id
join public.organizations o on o.id=s.organization_id
group by s.organization_id,s.branch_id,(s.completed_at at time zone coalesce(nullif(b.timezone,''),o.timezone))::date;
grant select on public.report_daily_sales to authenticated;
