grant select on public.suppliers, public.purchase_orders, public.purchase_order_lines, public.purchase_receipts, public.purchase_receipt_lines to authenticated;
grant insert, update on public.suppliers to authenticated;
revoke delete on public.suppliers from authenticated;
