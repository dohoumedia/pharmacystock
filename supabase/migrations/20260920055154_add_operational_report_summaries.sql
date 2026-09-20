-- Add branch-scoped operational report summaries.
create or replace view public.report_expiry_status_summary
with (security_invoker=true)
as
select
  ib.organization_id,
  ib.branch_id,
  count(*) filter (where b.status='EXPIRED' and ib.on_hand_quantity>0) as expired_batches,
  coalesce(sum(ib.on_hand_quantity) filter (where b.status='EXPIRED' and ib.on_hand_quantity>0),0)::numeric(18,4) as expired_units,
  count(*) filter (where b.status='QUARANTINED' and ib.on_hand_quantity>0) as quarantined_batches,
  coalesce(sum(ib.on_hand_quantity) filter (where b.status='QUARANTINED' and ib.on_hand_quantity>0),0)::numeric(18,4) as quarantined_units,
  count(*) filter (where b.status='RECALLED' and ib.on_hand_quantity>0) as recalled_batches,
  coalesce(sum(ib.on_hand_quantity) filter (where b.status='RECALLED' and ib.on_hand_quantity>0),0)::numeric(18,4) as recalled_units,
  count(*) filter (
    where b.status='ACTIVE'
      and b.expiry_date between current_date and current_date+30
      and ib.on_hand_quantity>0
  ) as expiring_30d_batches,
  coalesce(sum(ib.on_hand_quantity) filter (
    where b.status='ACTIVE'
      and b.expiry_date between current_date and current_date+30
      and ib.on_hand_quantity>0
  ),0)::numeric(18,4) as expiring_30d_units
from public.inventory_balances ib
join public.batches b
  on b.id=ib.batch_id
 and b.organization_id=ib.organization_id
 and b.branch_id=ib.branch_id
group by ib.organization_id,ib.branch_id;

create or replace view public.report_purchasing_summary
with (security_invoker=true)
as
with po_lines as (
  select
    po.id,
    po.organization_id,
    po.branch_id,
    po.status,
    coalesce(sum(pol.ordered_quantity),0)::numeric(18,4) as ordered_quantity,
    coalesce(sum(pol.received_quantity),0)::numeric(18,4) as received_quantity,
    coalesce(sum(pol.ordered_quantity*coalesce(pol.unit_cost,0)),0)::numeric(18,2) as ordered_value,
    coalesce(sum(greatest(pol.ordered_quantity-pol.received_quantity,0)*coalesce(pol.unit_cost,0)),0)::numeric(18,2) as outstanding_value
  from public.purchase_orders po
  left join public.purchase_order_lines pol on pol.purchase_order_id=po.id
  group by po.id,po.organization_id,po.branch_id,po.status
)
select
  organization_id,
  branch_id,
  count(*) filter (where status in ('draft','ordered','partially_received')) as open_orders,
  count(*) filter (where status='partially_received') as partially_received_orders,
  count(*) filter (where status='received') as received_orders,
  coalesce(sum(ordered_quantity),0)::numeric(18,4) as ordered_quantity,
  coalesce(sum(received_quantity),0)::numeric(18,4) as received_quantity,
  coalesce(sum(ordered_value),0)::numeric(18,2) as ordered_value,
  coalesce(sum(outstanding_value),0)::numeric(18,2) as outstanding_value
from po_lines
group by organization_id,branch_id;

create or replace view public.report_transfer_summary
with (security_invoker=true)
as
with transfer_lines as (
  select
    st.id,
    st.organization_id,
    st.source_branch_id,
    st.destination_branch_id,
    st.status,
    coalesce(sum(stl.requested_quantity),0)::numeric(18,4) as requested_quantity,
    coalesce(sum(stl.dispatched_quantity),0)::numeric(18,4) as dispatched_quantity,
    coalesce(sum(stl.received_quantity),0)::numeric(18,4) as received_quantity,
    coalesce(sum(abs(stl.discrepancy_quantity)),0)::numeric(18,4) as discrepancy_quantity
  from public.stock_transfers st
  left join public.stock_transfer_lines stl on stl.transfer_id=st.id
  group by st.id,st.organization_id,st.source_branch_id,st.destination_branch_id,st.status
),
branch_transfers as (
  select organization_id,source_branch_id as branch_id,status,requested_quantity,dispatched_quantity,received_quantity,discrepancy_quantity
  from transfer_lines
  union all
  select organization_id,destination_branch_id as branch_id,status,requested_quantity,dispatched_quantity,received_quantity,discrepancy_quantity
  from transfer_lines
  where destination_branch_id<>source_branch_id
)
select
  organization_id,
  branch_id,
  count(*) filter (where status in ('REQUESTED','APPROVED','DISPATCHED')) as open_transfers,
  count(*) filter (where status='DISPATCHED') as in_transit_transfers,
  count(*) filter (where status='RECEIVED') as received_transfers,
  coalesce(sum(requested_quantity),0)::numeric(18,4) as requested_quantity,
  coalesce(sum(dispatched_quantity),0)::numeric(18,4) as dispatched_quantity,
  coalesce(sum(received_quantity),0)::numeric(18,4) as received_quantity,
  coalesce(sum(discrepancy_quantity),0)::numeric(18,4) as discrepancy_quantity
from branch_transfers
group by organization_id,branch_id;

grant select on public.report_expiry_status_summary to authenticated;
grant select on public.report_purchasing_summary to authenticated;
grant select on public.report_transfer_summary to authenticated;
