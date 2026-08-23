create or replace function app_private.inventory_lock_key(p_organization_id uuid, p_branch_id uuid, p_batch_id uuid)
returns bigint
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $$
  select hashtextextended(p_organization_id::text || ':' || p_branch_id::text || ':' || p_batch_id::text, 0);
$$;

create index if not exists inventory_movements_org_batch_idx
  on public.inventory_movements(organization_id, batch_id);
create index if not exists inventory_stock_count_lines_org_batch_idx
  on public.inventory_stock_count_lines(organization_id, batch_id);
create index if not exists inventory_stock_count_lines_org_branch_idx
  on public.inventory_stock_count_lines(organization_id, branch_id);
create index if not exists inventory_stock_count_lines_org_idx
  on public.inventory_stock_count_lines(organization_id);
