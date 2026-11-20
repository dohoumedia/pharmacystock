-- Functional fixture only. Runs in disposable PostgreSQL and rolls back.
begin;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
values('cf000000-0000-0000-0000-000000000001','catalog-owner@test.invalid',now(),'{}');
insert into public.organizations(id,name,slug,currency_code,timezone,default_locale)
values('cf000000-0000-0000-0000-000000000002','Catalog Fixture','catalog-fixture','EUR','UTC','fr');
insert into public.branches(id,organization_id,name)
values('cf000000-0000-0000-0000-000000000003','cf000000-0000-0000-0000-000000000002','Main');
insert into public.organization_memberships(id,organization_id,user_id,role_id,status)
select 'cf000000-0000-0000-0000-000000000004','cf000000-0000-0000-0000-000000000002','cf000000-0000-0000-0000-000000000001',id,'active'
from public.roles where organization_id is null and code='OWNER';
insert into public.branch_memberships(branch_id,organization_membership_id)
values('cf000000-0000-0000-0000-000000000003','cf000000-0000-0000-0000-000000000004');

create function public.catalog_test_assert(v boolean,label text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'FAILED: %',label; end if; end $$;
grant execute on function public.catalog_test_assert(boolean,text) to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','cf000000-0000-0000-0000-000000000001',true);

do $$
declare
 org constant uuid:='cf000000-0000-0000-0000-000000000002';
 branch constant uuid:='cf000000-0000-0000-0000-000000000003';
 supplier uuid; a uuid; b uuid; po uuid; la uuid; lb uuid; r1 uuid; r2 uuid; batch_a uuid; n integer; payload jsonb; result uuid;
begin
 insert into public.suppliers(organization_id,name,phone) values(org,'Original Supplier','old') returning id into supplier;
 update public.suppliers set name='Updated Supplier',phone='new',email='new@example.invalid',address='Road' where id=supplier;
 perform public.catalog_test_assert((select name='Updated Supplier' and phone='new' from public.suppliers where id=supplier),'supplier contact maintained');
 a:=public.create_catalog_product(org,'{"name":"Medicine A","stock_unit":"tablet"}');
 b:=public.create_catalog_product(org,'{"name":"Medicine B","stock_unit":"bottle"}');
 po:=public.create_purchase_order(org,branch,supplier,'PO-PARTIAL',null,null,jsonb_build_array(jsonb_build_object('product_id',a,'quantity',10,'unit_cost',1.25),jsonb_build_object('product_id',b,'quantity',3,'unit_cost',5)),'po-stable');
 perform public.catalog_test_assert((select status='ordered' from public.purchase_orders where id=po),'submitted status');
 perform public.catalog_test_assert(public.create_purchase_order(org,branch,supplier,'PO-PARTIAL',null,null,jsonb_build_array(jsonb_build_object('product_id',a,'quantity',10)),'po-stable')=po,'order exact retry identity');
 select id into la from public.purchase_order_lines where purchase_order_id=po and product_id=a;
 select id into lb from public.purchase_order_lines where purchase_order_id=po and product_id=b;
 payload:=jsonb_build_array(jsonb_build_object('purchase_order_line_id',la,'quantity',2.5,'unit_cost',1.25,'selling_price',2.5,'lot_number','A-LOT','expiry_date',current_date+365),jsonb_build_object('purchase_order_line_id',lb,'quantity',3,'unit_cost',5,'selling_price',7,'lot_number','B-LOT','expiry_date',current_date+366));
 r1:=public.receive_purchase_order(po,'R-FIRST',null,payload,null,'receipt-stable');
 perform public.catalog_test_assert((select status='partially_received' from public.purchase_orders where id=po),'partial status');
 perform public.catalog_test_assert((select ordered_quantity-received_quantity=7.5 from public.purchase_order_lines where id=la),'remaining A=7.5');
 perform public.catalog_test_assert((select ordered_quantity-received_quantity=0 from public.purchase_order_lines where id=lb),'remaining B=0');
 perform public.catalog_test_assert(public.receive_purchase_order(po,'R-FIRST',null,payload,null,'receipt-stable')=r1,'receipt retry returns original');
 perform public.catalog_test_assert((select count(*)=2 from public.purchase_receipt_lines where receipt_id=r1),'receipt drilldown lines');
 perform public.catalog_test_assert((select count(*)=2 from public.inventory_movements where reference_id=r1::text),'one movement per posted line');
 perform public.catalog_test_assert((select count(*)=2 from public.purchase_receipt_lines rl join public.batches ba on ba.id=rl.batch_id join public.inventory_movements m on m.id=rl.inventory_movement_id where rl.receipt_id=r1 and m.batch_id=ba.id and m.quantity_delta=rl.quantity),'receipt batch ledger traceability');
 update public.suppliers set status='inactive' where id=supplier;
 perform public.catalog_test_assert((select supplier_id=supplier from public.purchase_orders where id=po),'deactivation preserves PO link');
 perform public.catalog_test_assert((select count(*)=1 from public.purchase_receipts where id=r1),'deactivation preserves receipt');
 begin
  perform public.create_purchase_order(org,branch,supplier,'PO-INACTIVE',null,null,jsonb_build_array(jsonb_build_object('product_id',a,'quantity',1)),'inactive');
  raise exception 'Expected inactive supplier rejection';
 exception when foreign_key_violation then perform public.catalog_test_assert(sqlerrm='SUPPLIER_NOT_FOUND','inactive excluded from new orders'); end;
 begin
  perform public.receive_purchase_order(po,'R-OVER',null,jsonb_build_array(jsonb_build_object('purchase_order_line_id',la,'quantity',8,'selling_price',2.5,'lot_number','OVER','expiry_date',current_date+365)),null,'over');
  raise exception 'Expected overreceive rejection';
 exception when check_violation then perform public.catalog_test_assert(sqlerrm='INVALID_RECEIPT_QUANTITY','server rejects overreceive'); end;
 perform public.catalog_test_assert((select count(*)=1 from public.purchase_receipts where purchase_order_id=po),'failed receipt is atomic');
 begin
  perform public.receive_purchase_order(po,'R-DUP',null,jsonb_build_array(payload->0,payload->0),null,'dup');
  raise exception 'Expected duplicate line rejection';
 exception when check_violation then perform public.catalog_test_assert(sqlerrm='DUPLICATE_PURCHASE_ORDER_LINE','duplicate line rejected before writes'); end;
 for n in 1..5 loop
  begin
   perform public.receive_purchase_order(po,'R-BAD-'||n,null,jsonb_build_array(jsonb_build_object('purchase_order_line_id',la,'quantity',1,'unit_cost',case when n=3 then -1 else 1.25 end,'selling_price',case when n=4 then 0 when n=5 then 99 else 2.5 end,'lot_number',case when n=1 then '' else 'A-LOT' end,'expiry_date',case when n=2 then '2027-02-29' else (current_date+365)::text end)),null,'bad-'||n);
   raise exception 'Expected invalid receipt rejection';
  exception when check_violation then perform public.catalog_test_assert(true,'invalid lot/date/cost/price/mismatch rejected'); end;
 end loop;
 perform public.catalog_test_assert((select count(*)=1 from public.purchase_receipts where purchase_order_id=po),'invalid inputs leave receipt count unchanged');
 r2:=public.receive_purchase_order(po,'R-FINAL',null,jsonb_build_array(jsonb_build_object('purchase_order_line_id',la,'quantity',7.5,'unit_cost',1.25,'selling_price',2.5,'lot_number','A-OTHER-LOT','expiry_date',current_date+367)),null,'final');
 perform public.catalog_test_assert((select status='received' from public.purchase_orders where id=po),'final received status');
 perform public.catalog_test_assert((select sum(ordered_quantity-received_quantity)=0 from public.purchase_order_lines where purchase_order_id=po),'all remaining zero');
 perform public.catalog_test_assert((select count(*)=2 from public.batches where product_id=a),'same product different lots');
 perform public.catalog_test_assert((select sum(quantity_delta)=10 from public.inventory_movements m join public.batches ba on ba.id=m.batch_id where ba.product_id=a),'ledger A total=10');
 perform public.catalog_test_assert((select sum(on_hand_quantity)=10 from public.inventory_balances where product_id=a),'derived balance A=10');
 perform public.catalog_test_assert(public.receive_purchase_order(po,'R-FINAL',null,jsonb_build_array(jsonb_build_object('purchase_order_line_id',la,'quantity',7.5,'selling_price',2.5,'lot_number','A-OTHER-LOT','expiry_date',current_date+367)),null,'final')=r2,'retry after received status');
 perform public.catalog_test_assert((select count(*)=2 from public.purchase_receipts where purchase_order_id=po),'no duplicate receipt after retry');
 perform public.catalog_test_assert((select count(*)=3 from public.inventory_movements where reference_id in (r1::text,r2::text)),'no duplicate ledger after retry');
 perform public.catalog_test_assert((select count(*)=2 from public.audit_logs where event_type='purchase.received' and metadata->>'purchase_order_id'=po::text),'no duplicate receipt audit');
 update public.suppliers set status='active' where id=supplier;
 result:=public.create_purchase_order(org,branch,supplier,'PO-MATCH',null,null,jsonb_build_array(jsonb_build_object('product_id',a,'quantity',2,'unit_cost',1.25)),'po-match');
 select id into la from public.purchase_order_lines where purchase_order_id=result;
 select batch_id into batch_a from public.purchase_receipt_lines where receipt_id=r1 and purchase_order_line_id in (select id from public.purchase_order_lines where product_id=a);
 for n in 1..2 loop
  perform public.receive_purchase_order(result,'R-MATCH-'||n,null,jsonb_build_array(jsonb_build_object('purchase_order_line_id',la,'quantity',1,'unit_cost',1.25,'selling_price',2.5,'lot_number','A-LOT','expiry_date',current_date+365)),null,'match-'||n);
 end loop;
 perform public.catalog_test_assert((select count(*)=1 from public.batches where product_id=a and lot_number='A-LOT'),'same eligible lot matched, no duplicate batch');
 perform public.catalog_test_assert((select on_hand_quantity=4.5 from public.inventory_balances where batch_id=batch_a),'matched batch derived balance');
 perform public.catalog_test_assert((select count(*)=3 from public.purchase_receipt_lines where batch_id=batch_a),'matched batch retains every receipt provenance');
 perform public.catalog_test_assert((select status='received' from public.purchase_orders where id=result),'matched batch final lifecycle');
end $$;
-- Existing cancelled states are fixtures, not a supported end-user cancellation action.
reset role;
update public.purchase_orders set status='cancelled' where po_number='PO-PARTIAL';
set local role authenticated;
do $$
declare po uuid; line uuid;
begin
 select id into po from public.purchase_orders where po_number='PO-PARTIAL';
 select id into line from public.purchase_order_lines where purchase_order_id=po limit 1;
 perform public.catalog_test_assert((select count(*)=2 from public.purchase_receipts where purchase_order_id=po),'cancelled state retains receipt history');
 begin
  perform public.receive_purchase_order(po,'R-CANCELLED',null,jsonb_build_array(jsonb_build_object('purchase_order_line_id',line,'quantity',1,'selling_price',2.5,'lot_number','CANCELLED','expiry_date',current_date+365)),null,'cancelled');
  raise exception 'Expected cancelled order rejection';
 exception when check_violation then perform public.catalog_test_assert(sqlerrm='PURCHASE_ORDER_NOT_RECEIVABLE','cancelled is not receivable'); end;
end $$;
rollback;
