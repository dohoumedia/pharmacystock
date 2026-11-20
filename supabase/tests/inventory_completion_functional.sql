-- Daily inventory workflows against disposable local PostgreSQL only.
begin;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('cf000000-0000-0000-0000-000000000001','inventory@test.invalid',now(),'{}');
insert into public.organizations(id,name,slug,currency_code,timezone,default_locale) values('cf000000-0000-0000-0000-000000000002','Inventory Fixture','inventory-fixture','EUR','UTC','fr');
insert into public.branches(id,organization_id,name) values('cf000000-0000-0000-0000-000000000003','cf000000-0000-0000-0000-000000000002','Main');
insert into public.organization_memberships(id,organization_id,user_id,role_id,status)
select 'cf000000-0000-0000-0000-000000000004','cf000000-0000-0000-0000-000000000002','cf000000-0000-0000-0000-000000000001',id,'active' from public.roles where organization_id is null and code='OWNER';
insert into public.branch_memberships(branch_id,organization_membership_id) values('cf000000-0000-0000-0000-000000000003','cf000000-0000-0000-0000-000000000004');
create function public.inventory_test_assert(value boolean,label text) returns void language plpgsql as $$ begin if value is distinct from true then raise exception 'FAILED: %',label; end if; end $$;
grant execute on function public.inventory_test_assert(boolean,text) to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','cf000000-0000-0000-0000-000000000001',true);
do $$
declare
 org constant uuid:='cf000000-0000-0000-0000-000000000002';
 branch constant uuid:='cf000000-0000-0000-0000-000000000003';
 product uuid; batch uuid; second uuid; third uuid; movement uuid; result uuid; stock_count uuid; no_variance uuid; failed_count uuid; n integer;
begin
 product:=public.create_catalog_product(org,'{"name":"Medicine","stock_unit":"tablet","sku":"SKU-140","barcode":"900140"}');
 insert into public.batches(organization_id,branch_id,product_id,lot_number,expiry_date,status,purchase_cost,selling_price) values(org,branch,product,'LOT-140',current_date+365,'ACTIVE',1,2) returning id into batch;
 insert into public.batches(organization_id,branch_id,product_id,lot_number,expiry_date,status,purchase_cost,selling_price) values(org,branch,product,'LOT-141',current_date+365,'ACTIVE',1,2) returning id into second;
 insert into public.batches(organization_id,branch_id,product_id,lot_number,expiry_date,status,purchase_cost,selling_price) values(org,branch,product,'LOT-142',current_date+365,'ACTIVE',1,2) returning id into third;
 perform public.post_inventory_movement(org,branch,batch,'ADJUSTMENT_IN',10,'seed:a','Opening fixture');
 perform public.post_inventory_movement(org,branch,second,'ADJUSTMENT_IN',10,'seed:b','Opening fixture');
 perform public.post_inventory_movement(org,branch,third,'ADJUSTMENT_IN',10,'seed:c','Opening fixture');
 movement:=public.post_inventory_movement(org,branch,batch,'ADJUSTMENT_OUT',-2.5,'adjustment:stable','Damaged package','MANUAL_ADJUSTMENT','CORR-1');
 result:=public.post_inventory_movement(org,branch,batch,'ADJUSTMENT_OUT',-2.5,'adjustment:stable','Damaged package','MANUAL_ADJUSTMENT','CORR-1');
 perform public.inventory_test_assert(result=movement,'lost adjustment response recovers same movement');
 perform public.inventory_test_assert((select on_hand_quantity=7.5 from public.inventory_balances where batch_id=batch),'decrease once');
 perform public.inventory_test_assert((select reason='Damaged package' and reference_id='CORR-1' from public.inventory_movements where id=movement),'adjustment traceability');
 perform public.post_inventory_movement(org,branch,batch,'ADJUSTMENT_IN',1.25,'adjustment:increase','Found package');
 perform public.inventory_test_assert((select on_hand_quantity=8.75 from public.inventory_balances where batch_id=batch),'increase once');
 begin
   perform public.post_inventory_movement(org,branch,batch,'ADJUSTMENT_OUT',-20,'invalid:negative','Invalid');
   raise exception 'FAILED: insufficient stock accepted';
 exception when check_violation then null; end;
 insert into public.inventory_stock_counts(id,organization_id,branch_id) values('cf000000-0000-0000-0000-000000000099',org,branch) returning id into stock_count;
 insert into public.inventory_stock_count_lines(stock_count_id,organization_id,branch_id,batch_id,counted_quantity) values(stock_count,org,branch,batch,8),(stock_count,org,branch,second,12.5),(stock_count,org,branch,third,10);
 perform public.inventory_test_assert((select count(*)=3 from public.inventory_stock_count_lines where stock_count_id=stock_count),'durable draft scope');
 perform public.inventory_test_assert((select status='OPEN' from public.inventory_stock_counts where id=stock_count),'open count reload');
 perform public.complete_inventory_stock_count(stock_count);
 perform public.inventory_test_assert((select status='COMPLETED' from public.inventory_stock_counts where id=stock_count),'count completed');
 perform public.inventory_test_assert((select count(*)=2 from public.inventory_movements where reference_type='STOCK_COUNT' and reference_id=stock_count::text),'only two nonzero variance movements');
 perform public.inventory_test_assert((select quantity_delta=-0.75 from public.inventory_movements where reference_id=stock_count::text and batch_id=batch),'negative variance');
 perform public.inventory_test_assert((select quantity_delta=2.5 from public.inventory_movements where reference_id=stock_count::text and batch_id=second),'positive variance');
 perform public.inventory_test_assert((select expected_quantity=8.75 and counted_quantity=8 from public.inventory_stock_count_lines where stock_count_id=stock_count and batch_id=batch),'saved actual expected and counted');
 perform public.inventory_test_assert((select on_hand_quantity=8 from public.inventory_balances where batch_id=batch),'resulting first balance');
 perform public.inventory_test_assert((select on_hand_quantity=12.5 from public.inventory_balances where batch_id=second),'resulting second balance');
 select count(*) into n from public.inventory_movements;
 -- Existing RLS may hide a completed row from SELECT FOR UPDATE (P0002).
 -- The client recovers it using its ordinary scoped read before retrying.
 begin perform public.complete_inventory_stock_count(stock_count); raise exception 'FAILED: completed twice'; exception when check_violation or no_data_found then null; end;
 perform public.inventory_test_assert((select count(*)=n from public.inventory_movements),'reconcile retry cannot duplicate');
 perform public.inventory_test_assert((select count(*)=1 from public.audit_logs where event_type='inventory.stock_count.completed' and entity_id=stock_count::text),'one completion audit');
 perform public.inventory_test_assert(not has_table_privilege('authenticated','public.audit_logs','INSERT'),'no direct audit write grant');
 perform public.inventory_test_assert((select metadata @> '{"line_count":3,"expected_quantity_total":28.75,"counted_quantity_total":30.5,"quantity_delta_total":1.75}' from public.audit_logs where event_type='inventory.stock_count.completed' and entity_id=stock_count::text),'audit totals preserve completion contract');
 insert into public.inventory_stock_counts(organization_id,branch_id) values(org,branch) returning id into no_variance;
 insert into public.inventory_stock_count_lines(stock_count_id,organization_id,branch_id,batch_id,counted_quantity) values(no_variance,org,branch,batch,8);
 perform public.complete_inventory_stock_count(no_variance);
 perform public.inventory_test_assert((select count(*)=0 from public.inventory_movements where reference_id=no_variance::text),'no variance creates no movement');
 -- An invalid inbound correction must roll the entire reconciliation back.
 update public.batches set status='RECALLED' where id=second;
 insert into public.inventory_stock_counts(organization_id,branch_id) values(org,branch) returning id into failed_count;
 insert into public.inventory_stock_count_lines(stock_count_id,organization_id,branch_id,batch_id,counted_quantity) values(failed_count,org,branch,batch,7),(failed_count,org,branch,second,15);
 begin perform public.complete_inventory_stock_count(failed_count); raise exception 'FAILED: invalid inbound count accepted'; exception when check_violation then null; end;
 perform public.inventory_test_assert((select status='OPEN' from public.inventory_stock_counts where id=failed_count),'rejected count remains resumable');
 perform public.inventory_test_assert((select count(*)=0 from public.inventory_movements where reference_id=failed_count::text),'failed count has no partial movements');
 perform public.inventory_test_assert((select count(*)=0 from public.audit_logs where event_type='inventory.stock_count.completed' and entity_id=failed_count::text),'failed count has no completion audit');
 update public.inventory_stock_count_lines set counted_quantity=12.5 where stock_count_id=failed_count and batch_id=second;
 perform public.complete_inventory_stock_count(failed_count);
 perform public.inventory_test_assert((select on_hand_quantity=7 from public.inventory_balances where batch_id=batch),'corrected count can retry successfully');
 perform public.inventory_test_assert((select count(*)=1 from public.search_catalog_batches(org,branch,'900140') where id=batch),'barcode server batch search');
 perform public.inventory_test_assert((select count(*)=1 from public.search_catalog_batches(org,branch,'LOT-141') where id=second),'lot server batch search');
end $$;
commit;
