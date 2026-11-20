-- Functional source-contract assertions in disposable, network-isolated PostgreSQL only.
begin;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('af000000-0000-0000-0000-000000000001','transfer@test.invalid',now(),'{}');
insert into public.organizations(id,name,slug) values('af000000-0000-0000-0000-000000000002','Transfer Fixture','transfer-fixture');
insert into public.branches(id,organization_id,name) values('af000000-0000-0000-0000-000000000003','af000000-0000-0000-0000-000000000002','Main'),('af000000-0000-0000-0000-000000000005','af000000-0000-0000-0000-000000000002','East');
insert into public.organization_memberships(id,organization_id,user_id,role_id,status)
select 'af000000-0000-0000-0000-000000000004','af000000-0000-0000-0000-000000000002','af000000-0000-0000-0000-000000000001',id,'active' from public.roles where organization_id is null and code='OWNER';
insert into public.branch_memberships(branch_id,organization_membership_id) values('af000000-0000-0000-0000-000000000003','af000000-0000-0000-0000-000000000004'),('af000000-0000-0000-0000-000000000005','af000000-0000-0000-0000-000000000004');
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('af000000-0000-0000-0000-000000000011','source@test.invalid',now(),'{}'),('af000000-0000-0000-0000-000000000012','destination@test.invalid',now(),'{}');
insert into public.organization_memberships(id,organization_id,user_id,role_id,status)
select 'af000000-0000-0000-0000-000000000014','af000000-0000-0000-0000-000000000002','af000000-0000-0000-0000-000000000011',id,'active' from public.roles where organization_id is null and code='INVENTORY_OFFICER';
insert into public.organization_memberships(id,organization_id,user_id,role_id,status)
select 'af000000-0000-0000-0000-000000000015','af000000-0000-0000-0000-000000000002','af000000-0000-0000-0000-000000000012',id,'active' from public.roles where organization_id is null and code='INVENTORY_OFFICER';
insert into public.branch_memberships(branch_id,organization_membership_id) values('af000000-0000-0000-0000-000000000003','af000000-0000-0000-0000-000000000014'),('af000000-0000-0000-0000-000000000005','af000000-0000-0000-0000-000000000015');
set local role authenticated;
select set_config('request.jwt.claim.sub','af000000-0000-0000-0000-000000000001',true);
do $$
declare
 org constant uuid:='af000000-0000-0000-0000-000000000002'; main constant uuid:='af000000-0000-0000-0000-000000000003'; east constant uuid:='af000000-0000-0000-0000-000000000005';
 product uuid; batch uuid; other_lot uuid; wrong_source uuid; blocked uuid; transfer uuid; repeat uuid; shortage uuid; cancelled uuid; line_id uuid; destination uuid; n integer; bad_status text; context jsonb;
begin
 product:=public.create_catalog_product(org,'{"name":"Transfer medicine","stock_unit":"tablet","sku":"TR-SKU","barcode":"900100"}');
 insert into public.batches(organization_id,branch_id,product_id,lot_number,expiry_date,purchase_cost,selling_price) values(org,main,product,'LOT-100',current_date+365,1,2) returning id into batch;
 insert into public.batches(organization_id,branch_id,product_id,lot_number,expiry_date,purchase_cost,selling_price) values(org,main,product,'LOT-101',current_date+366,3,4) returning id into other_lot;
 insert into public.batches(organization_id,branch_id,product_id,lot_number,expiry_date,purchase_cost,selling_price) values(org,east,product,'WRONG-SOURCE',current_date+365,1,2) returning id into wrong_source;
 perform public.post_inventory_movement(org,main,batch,'ADJUSTMENT_IN',20,'tr:seed:100','Fixture');
 perform public.post_inventory_movement(org,main,other_lot,'ADJUSTMENT_IN',10,'tr:seed:101','Fixture');
 transfer:=public.create_stock_transfer(org,main,east,'TR-PRIMARY',jsonb_build_array(jsonb_build_object('source_batch_id',batch,'quantity',10)),'tr:primary','Restock East');
 repeat:=public.create_stock_transfer(org,main,east,'TR-PRIMARY',jsonb_build_array(jsonb_build_object('source_batch_id',batch,'quantity',10)),'tr:primary','Restock East');
 perform public.inventory_test_assert(transfer=repeat,'duplicate request returns the same transfer');
 perform public.inventory_test_assert((select on_hand_quantity=20 from public.inventory_balances where batch_id=batch),'request does not move stock');
 perform set_config('request.jwt.claim.sub','af000000-0000-0000-0000-000000000011',true);
 perform public.inventory_test_assert((select count(*)=1 from public.list_stock_transfer_destinations(org,main) where id=east),'source-only officer can choose named destination');
 perform set_config('request.jwt.claim.sub','af000000-0000-0000-0000-000000000012',true);
 context:=public.read_stock_transfer_context(transfer);
 perform public.inventory_test_assert(context->'branches' @> jsonb_build_array(jsonb_build_object('id',main,'name','Main')),'destination-only officer sees source name');
 perform public.inventory_test_assert(context->'batches' @> jsonb_build_array(jsonb_build_object('id',batch,'lot_number','LOT-100')),'destination-only officer sees exact source lot before receipt');
 perform public.inventory_test_assert(context->'balances' @> jsonb_build_array(jsonb_build_object('batch_id',batch,'available_quantity',20)),'authorized approver sees only transfer-line source availability');
 perform public.inventory_test_assert(not exists(select 1 from jsonb_array_elements(context->'batches') b where b ? 'purchase_cost' or b ? 'notes'),'transfer projection excludes private batch cost and notes');
 perform public.approve_stock_transfer(transfer);
 perform set_config('request.jwt.claim.sub','af000000-0000-0000-0000-000000000011',true);
 perform public.inventory_test_assert((select requested_quantity=10 and dispatched_quantity=0 from public.stock_transfer_lines where transfer_id=transfer),'full approval retains quantity without moving stock');
 perform public.dispatch_stock_transfer(transfer);
 perform public.dispatch_stock_transfer(transfer);
 perform public.inventory_test_assert((select on_hand_quantity=10 and available_quantity=10 from public.inventory_balances where batch_id=batch),'source arithmetic 20 - 10 = 10');
 begin perform public.cancel_stock_transfer(transfer,'Too late'); raise exception 'FAILED: cancellation after dispatch accepted'; exception when check_violation then null; end;
 select id into line_id from public.stock_transfer_lines where transfer_id=transfer;
 perform set_config('request.jwt.claim.sub','af000000-0000-0000-0000-000000000012',true);
 perform public.receive_stock_transfer(transfer,jsonb_build_array(jsonb_build_object('line_id',line_id,'quantity',10)));
 perform public.receive_stock_transfer(transfer,jsonb_build_array(jsonb_build_object('line_id',line_id,'quantity',10)));
 perform set_config('request.jwt.claim.sub','af000000-0000-0000-0000-000000000001',true);
 select destination_batch_id into destination from public.stock_transfer_lines where transfer_id=transfer;
 perform public.inventory_test_assert((select on_hand_quantity=10 and available_quantity=10 from public.inventory_balances where batch_id=destination),'destination arithmetic 0 + 10 = 10');
 perform public.inventory_test_assert((select product_id=product and lot_number='LOT-100' and expiry_date=current_date+365 and purchase_cost=1 and selling_price=2 from public.batches where id=destination),'exact product/lot/expiry/cost/price provenance');
 perform public.inventory_test_assert((select count(*)=2 from public.inventory_movements where reference_type='STOCK_TRANSFER' and reference_id=transfer::text),'duplicate dispatch and lost receipt response create exactly two paired movements');
 perform public.inventory_test_assert((select count(*)=1 from public.audit_logs where event_type='transfer.received' and entity_id=transfer::text),'one receipt audit');
 perform public.inventory_test_assert((select l.transfer_out_movement_id=o.id and l.transfer_in_movement_id=i.id and o.branch_id=main and i.branch_id=east and o.quantity_delta=-10 and i.quantity_delta=10 from public.stock_transfer_lines l join public.inventory_movements o on o.id=l.transfer_out_movement_id join public.inventory_movements i on i.id=l.transfer_in_movement_id where l.transfer_id=transfer),'paired references, branches and quantities');
 shortage:=public.create_stock_transfer(org,main,east,'TR-SHORT',jsonb_build_array(jsonb_build_object('source_batch_id',other_lot,'quantity',4)),'tr:short');
 perform public.approve_stock_transfer(shortage); perform public.dispatch_stock_transfer(shortage);
 select id into line_id from public.stock_transfer_lines where transfer_id=shortage;
 perform public.receive_stock_transfer(shortage,jsonb_build_array(jsonb_build_object('line_id',line_id,'quantity',2.5,'reason','Damaged in transit')),'Investigate shortage');
 perform public.inventory_test_assert((select status='RECEIVED_WITH_DISCREPANCY' and discrepancy_notes='Investigate shortage' from public.stock_transfers where id=shortage),'final discrepancy status and note');
 perform public.inventory_test_assert((select received_quantity=2.5 and discrepancy_quantity=1.5 and discrepancy_reason='Damaged in transit' from public.stock_transfer_lines where transfer_id=shortage),'4 - 2.5 = 1.5 shortage');
 perform public.inventory_test_assert((select b.lot_number='LOT-101' and b.id<>destination from public.stock_transfer_lines l join public.batches b on b.id=l.destination_batch_id where l.transfer_id=shortage),'same product different lot remains independent');
 cancelled:=public.create_stock_transfer(org,main,east,'TR-CANCEL',jsonb_build_array(jsonb_build_object('source_batch_id',batch,'quantity',1)),'tr:cancel','Original note');
 perform public.approve_stock_transfer(cancelled); perform public.cancel_stock_transfer(cancelled,'No longer required');
 perform public.inventory_test_assert((select status='CANCELLED' and approved_at is not null and notes like '%Original note%No longer required%' from public.stock_transfers where id=cancelled),'cancellation preserves notes, approval and request');
 perform public.inventory_test_assert((select count(*)=1 from public.stock_transfer_lines where transfer_id=cancelled),'cancellation retains line history');
 perform public.inventory_test_assert((select count(*)=0 from public.inventory_movements where reference_id=cancelled::text),'cancellation has no stock effect');
 begin perform public.create_stock_transfer(org,main,main,'TR-SAME',jsonb_build_array(jsonb_build_object('source_batch_id',batch,'quantity',1)),'tr:same'); raise exception 'FAILED: same branches accepted'; exception when check_violation then null; end;
 begin perform public.create_stock_transfer(org,main,east,'TR-WRONG',jsonb_build_array(jsonb_build_object('source_batch_id',wrong_source,'quantity',1)),'tr:wrong'); raise exception 'FAILED: wrong-source batch accepted'; exception when check_violation then null; end;
 foreach bad_status in array array['QUARANTINED','RECALLED','EXPIRED'] loop
   insert into public.batches(organization_id,branch_id,product_id,lot_number,expiry_date,status) values(org,main,product,'BLOCK-'||bad_status,current_date+365,bad_status) returning id into blocked;
   begin perform public.create_stock_transfer(org,main,east,'TR-'||bad_status,jsonb_build_array(jsonb_build_object('source_batch_id',blocked,'quantity',1)),'tr:'||bad_status); raise exception 'FAILED: blocked stock accepted'; exception when check_violation then null; end;
 end loop;
 -- Existing request/approval RPCs do not reserve or enforce quantity availability.
 -- The UI preflights availability; the authoritative dispatch must still roll back excess.
 repeat:=public.create_stock_transfer(org,main,east,'TR-EXCESS',jsonb_build_array(jsonb_build_object('source_batch_id',batch,'quantity',100)),'tr:excess');
 perform public.approve_stock_transfer(repeat);
 select count(*) into n from public.inventory_movements;
 begin perform public.dispatch_stock_transfer(repeat); raise exception 'FAILED: excess dispatch accepted'; exception when check_violation then null; end;
 perform public.inventory_test_assert((select count(*)=n from public.inventory_movements),'excess dispatch rolls back without movement');
 perform public.inventory_test_assert((select status='APPROVED' from public.stock_transfers where id=repeat),'failed dispatch preserves status');
end $$;
commit;
