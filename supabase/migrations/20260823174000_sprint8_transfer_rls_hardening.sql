drop policy if exists stock_transfer_lines_read on public.stock_transfer_lines;
create policy stock_transfer_lines_read on public.stock_transfer_lines for select to authenticated using (
  app_private.is_org_member(organization_id)
  and app_private.has_permission(organization_id,'transfer.read')
  and exists (
    select 1 from public.stock_transfers t
    where t.id=stock_transfer_lines.transfer_id
      and t.organization_id=stock_transfer_lines.organization_id
      and (app_private.has_branch_access(t.source_branch_id) or app_private.has_branch_access(t.destination_branch_id) or app_private.has_permission(t.organization_id,'branch.manage'))
  )
);
