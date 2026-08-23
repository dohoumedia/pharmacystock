alter table public.inventory_movements drop constraint if exists inventory_movements_movement_type_check;
alter table public.inventory_movements add constraint inventory_movements_movement_type_check check (movement_type in (
  'PURCHASE_RECEIPT','SALE','RETURN_IN','RETURN_OUT','TRANSFER_IN','TRANSFER_OUT',
  'DAMAGE','EXPIRY','ADJUSTMENT_IN','ADJUSTMENT_OUT','COUNT_CORRECTION_IN','COUNT_CORRECTION_OUT',
  'SUPPLIER_RETURN','DISPOSAL'
));

alter table public.inventory_movements drop constraint if exists inventory_movement_sign_ck;
alter table public.inventory_movements add constraint inventory_movement_sign_ck check (
  (movement_type in ('PURCHASE_RECEIPT','RETURN_IN','TRANSFER_IN','ADJUSTMENT_IN','COUNT_CORRECTION_IN') and quantity_delta > 0)
  or
  (movement_type in ('SALE','RETURN_OUT','TRANSFER_OUT','DAMAGE','EXPIRY','ADJUSTMENT_OUT','COUNT_CORRECTION_OUT','SUPPLIER_RETURN','DISPOSAL') and quantity_delta < 0)
);
