grant insert on public.inventory_movements to authenticated;
grant insert, update on public.inventory_stock_counts, public.inventory_stock_count_lines to authenticated;
revoke delete on public.inventory_movements, public.inventory_stock_counts, public.inventory_stock_count_lines from authenticated;
