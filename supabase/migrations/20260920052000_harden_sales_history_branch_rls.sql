-- Enforce branch isolation for sale/refund line-item reads.
drop policy if exists sale_items_read on public.sale_items;
create policy sale_items_read
on public.sale_items
for select
to authenticated
using (
  app_private.has_permission(organization_id,'sale.read')
  and exists (
    select 1
    from public.sales s
    where s.id=sale_items.sale_id
      and s.organization_id=sale_items.organization_id
      and app_private.has_branch_access(s.branch_id)
  )
);

drop policy if exists refund_items_read on public.sale_refund_items;
create policy refund_items_read
on public.sale_refund_items
for select
to authenticated
using (
  app_private.has_permission(organization_id,'sale.read')
  and exists (
    select 1
    from public.sale_refunds r
    where r.id=sale_refund_items.refund_id
      and r.organization_id=sale_refund_items.organization_id
      and app_private.has_branch_access(r.branch_id)
  )
);
