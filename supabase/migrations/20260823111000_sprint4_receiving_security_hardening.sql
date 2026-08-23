alter function public.receive_purchase_order(uuid,text,text,jsonb,text) security invoker;

grant insert on public.purchase_receipts, public.purchase_receipt_lines to authenticated;

create policy receipts_insert on public.purchase_receipts
for insert with check(
  app_private.has_branch_access(branch_id)
  and app_private.has_permission(organization_id,'purchase.receive')
  and received_by=auth.uid()
);

create policy receipt_lines_insert on public.purchase_receipt_lines
for insert with check(
  app_private.is_org_member(organization_id)
  and app_private.has_permission(organization_id,'purchase.receive')
);
