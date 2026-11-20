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
declare org constant uuid:='cf000000-0000-0000-0000-000000000002';
 branch constant uuid:='cf000000-0000-0000-0000-000000000003';
 product uuid; other_product uuid; batch uuid; result uuid; barcode_id uuid; job uuid; imported integer; before_cost numeric;
begin
 product:=public.create_catalog_product(org,'{"name":"Catalog medicine","sku":"CAT-1","stock_unit":"tablet","package_size":"Box of 20","barcode":"100001"}');
 perform public.catalog_test_assert((select stock_unit='tablet' and package_size='Box of 20' from public.products where id=product),'stock unit distinct from package description');
 update public.products set name='Maintained medicine',sku='CAT-EDIT',stock_unit='box' where id=product;
 perform public.catalog_test_assert((select name='Maintained medicine' and sku='CAT-EDIT' and stock_unit='box' from public.products where id=product),'product edit and pre-stock unit edit');
 update public.products set status='archived',archived_at=now() where id=product;
 perform public.catalog_test_assert(not exists(select 1 from public.search_catalog_products(org,'CAT-EDIT','active')),'archive removed from active selector');
 update public.products set status='active',archived_at=null where id=product;
 perform public.catalog_test_assert(exists(select 1 from public.search_catalog_products(org,'CAT-EDIT','active')),'product restore');
 other_product:=public.create_catalog_product(org,'{"name":"Other medicine","sku":"OTHER"}');
 begin
  update public.products set sku='CAT-EDIT' where id=other_product;
  raise exception 'Expected SKU conflict';
 exception when unique_violation then null; end;
 perform * from public.maintain_product_barcode(org,product,'ADD','100002',null);
 perform * from public.maintain_product_barcode(org,product,'ADD','100002',null);
 perform public.catalog_test_assert((select count(*)=2 from public.product_barcodes where product_id=product),'barcode add exact retry');
 select id into barcode_id from public.product_barcodes where product_id=product and barcode='100002';
 perform * from public.maintain_product_barcode(org,product,'PRIMARY',null,barcode_id);
 perform public.catalog_test_assert((select is_primary from public.product_barcodes where id=barcode_id),'set primary barcode');
 perform * from public.maintain_product_barcode(org,product,'REMOVE',null,barcode_id);
 perform public.catalog_test_assert((select count(*)=1 and bool_and(is_primary) from public.product_barcodes where product_id=product),'remove primary promotes remaining');
 begin
  perform * from public.maintain_product_barcode(org,other_product,'ADD','100001',null);
  raise exception 'Expected barcode conflict';
 exception when unique_violation then perform public.catalog_test_assert(sqlerrm='BARCODE_ALREADY_EXISTS','barcode conflict code'); end;
 perform public.catalog_test_assert(exists(select 1 from public.search_catalog_products(org,'100001')),'secondary store searched by barcode');

 insert into public.products(organization_id,name,sku) select org,'Large catalog '||lpad(n::text,3,'0'),'LARGE-'||n from generate_series(1,220) n;
 perform public.catalog_test_assert((select count(*)=220 from public.search_catalog_products(org,'Large catalog')),'full catalog query');
 perform public.catalog_test_assert(exists(select 1 from public.search_catalog_products(org,'LARGE-220')),'product beyond old 80/200 limits found');
 perform public.catalog_test_assert((select count(*)=20 from (select * from public.search_catalog_products(org,'Large catalog') offset 200 limit 20) page),'large catalog last page');
 insert into public.batches(organization_id,branch_id,product_id,lot_number,expiry_date)
 select org,branch,other_product,'LOT-'||lpad(n::text,3,'0'),current_date+365+n from generate_series(1,105)n;
 perform public.catalog_test_assert(exists(select 1 from public.search_catalog_batches(org,branch,'LOT-105')),'batch beyond old 60 limit found');
 perform public.catalog_test_assert((select count(*)=5 from (select * from public.search_catalog_batches(org,branch,'LOT-') offset 100 limit 20) page),'large batch final page');

 batch:=public.post_opening_stock(org,branch,product,'OPEN-1',current_date+365,12.5,2.25,4.50,'Opening stock','opening-fixture-1');
 result:=public.post_opening_stock(org,branch,product,'OPEN-1',current_date+365,12.5,2.25,4.50,'Opening stock','opening-fixture-1');
 perform public.catalog_test_assert(batch=result,'opening stock batch retry identity');
 perform public.catalog_test_assert((select count(*)=1 from public.inventory_movements where idempotency_key='opening-fixture-1'),'opening ledger exactly once');
 perform public.catalog_test_assert((select on_hand_quantity=12.5 and reserved_quantity=0 and available_quantity=12.5 from public.inventory_balances where batch_id=batch),'opening stock normal derived balances');
 perform public.catalog_test_assert((select purchase_cost=2.25 and selling_price=4.50 from public.batches where id=batch),'opening cost and selling price distinct');
 perform public.catalog_test_assert((select unit_cost=2.25 and reference_type='OPENING_STOCK' and reason='Opening stock' from public.inventory_movements where batch_id=batch),'opening movement cost/source/reason');
 begin
  perform public.post_opening_stock(org,branch,product,'OPEN-1',current_date+365,13,2.25,4.50,'Opening stock','opening-fixture-1');
  raise exception 'Expected idempotency payload mismatch';
 exception when check_violation then perform public.catalog_test_assert(sqlerrm='IDEMPOTENCY_PAYLOAD_MISMATCH','changed retry payload rejected'); end;
 begin
  perform public.post_opening_stock(org,branch,product,'OPEN-1',current_date+364,1,2.25,4.50,'Opening stock','opening-fixture-2');
  raise exception 'Expected batch metadata mismatch';
 exception when check_violation then perform public.catalog_test_assert(sqlerrm='OPENING_STOCK_BATCH_MISMATCH','same lot metadata rejected'); end;
 begin
  update public.products set stock_unit='tablet' where id=product;
  raise exception 'Expected stock unit lock';
 exception when check_violation then perform public.catalog_test_assert(sqlerrm='STOCK_UNIT_LOCKED','unit cannot reinterpret ledger'); end;
 begin
  perform public.post_opening_stock(org,branch,product,'INVALID-QTY',current_date+365,0,2.25,4.50,'Opening stock','opening-invalid');
  raise exception 'Expected positive quantity validation';
 exception when check_violation then null; end;
 perform public.catalog_test_assert(not exists(select 1 from public.batches where lot_number='INVALID-QTY'),'invalid opening creates no batch');
 select purchase_cost into before_cost from public.batches where id=batch;
 update public.batches set selling_price=5.50 where id=batch and selling_price=4.50;
 perform public.catalog_test_assert((select selling_price=5.50 and purchase_cost=before_cost from public.batches where id=batch),'repricing preserves cost');
 begin
  update public.batches set selling_price=0 where id=batch;
  raise exception 'Expected positive batch selling price';
 exception when check_violation then null; end;
 perform public.catalog_test_assert(exists(select 1 from public.search_inventory_stock(org,branch,'OPEN-1') where batch_id=batch),'inventory search lot');
 perform public.catalog_test_assert(exists(select 1 from public.audit_logs where entity_type='batches' and entity_id=batch::text and event_type='batches.update'),'repricing audited');

 insert into public.import_jobs(organization_id,branch_id,import_type,status,total_rows,valid_rows,invalid_rows)
 values(org,branch,'OPENING_STOCK','READY',2,1,1) returning id into job;
 insert into public.import_rows(import_job_id,organization_id,row_number,raw_data,normalized_data,status,errors)
 values(job,org,2,'{}',jsonb_build_object('sku','CAT-EDIT','lot_number','IMPORTED-1','expiry_date',(current_date+400)::text,'quantity','1.5','purchase_cost','2.25','selling_price','5.50'),'VALID','[]'),
       (job,org,3,'{}','{}','INVALID','["CSV_ROW_WIDTH"]');
 imported:=public.commit_import_job(job);
 perform public.catalog_test_assert(imported=1,'valid opening import row posted');
 perform public.catalog_test_assert((select status='FAILED' and valid_rows=1 and invalid_rows=1 from public.import_jobs where id=job),'invalid staged row retained in result');
 perform public.catalog_test_assert((select count(*)=2 from public.import_rows where import_job_id=job),'no malformed staged row silently dropped');
 perform public.catalog_test_assert((select errors='["CSV_ROW_WIDTH"]'::jsonb from public.import_rows where import_job_id=job and row_number=3),'original malformed row error preserved');
 perform public.catalog_test_assert((select count(*)=1 from public.inventory_movements where idempotency_key like 'opening-import:'||job::text||':%'),'import uses shared opening ledger');
 imported:=public.commit_import_job(job);
 perform public.catalog_test_assert(imported=1,'partial import retry returns saved cumulative result');
 perform public.catalog_test_assert((select count(*)=1 from public.inventory_movements where idempotency_key like 'opening-import:'||job::text||':%'),'import retry remains exactly once');

 insert into public.import_jobs(organization_id,import_type,status,total_rows,valid_rows)
 values(org,'PRODUCTS','READY',1,1) returning id into job;
 insert into public.import_rows(import_job_id,organization_id,row_number,raw_data,normalized_data,status)
 values(job,org,2,'{}','{"name":"Supplier, SARL medicine","sku":"IMPORT-PRODUCT","stock_unit":"bottle","barcode":"IMPORT-BC"}','VALID');
 imported:=public.commit_import_job(job);
 perform public.catalog_test_assert(imported=1 and exists(select 1 from public.products where sku='IMPORT-PRODUCT' and stock_unit='bottle'),'product import retains unit');
 perform public.catalog_test_assert(exists(select 1 from public.search_catalog_products(org,'IMPORT-BC')),'product import retains barcode');
 imported:=public.commit_import_job(job);
 perform public.catalog_test_assert(imported=1,'completed import retry returns completed result');
end $$;
reset role;
rollback;
