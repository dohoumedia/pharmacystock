-- Sprint 6 POS / sales regression tests. Run only on an isolated database; rolled back.
begin;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) values
('66000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pos-owner@test.invalid','',now(),now(),now(),'{}','{}'),
('66000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pos-cashier@test.invalid','',now(),now(),now(),'{}','{}')
on conflict(id) do nothing;
insert into public.organizations(id,name,slug,currency_code,timezone) values('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','POS Test Pharmacy','pos-test-pharmacy','CAD','America/Toronto') on conflict(id) do nothing;
insert into public.branches(id,organization_id,name,code) values('6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Main','MAIN') on conflict(id) do nothing;
insert into public.organization_memberships(id,organization_id,user_id,role_id,status) values
('6a100000-0000-0000-0000-000000000001','6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','66000000-0000-0000-0000-000000000001',(select id from public.roles where organization_id is null and code='OWNER'),'active'),
('6a100000-0000-0000-0000-000000000002','6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','66000000-0000-0000-0000-000000000002',(select id from public.roles where organization_id is null and code='CASHIER'),'active')
on conflict(id) do nothing;
insert into public.branch_memberships(branch_id,organization_membership_id) values
('6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','6a100000-0000-0000-0000-000000000001'),
('6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','6a100000-0000-0000-0000-000000000002') on conflict do nothing;
insert into public.products(id,organization_id,name,status) values('6aaaaaaa-2222-2222-2222-aaaaaaaaaaaa','6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','POS Product','active') on conflict(id) do nothing;
insert into public.batches(id,organization_id,branch_id,product_id,lot_number,expiry_date,purchase_cost,selling_price,status) values
('6aaaaaaa-3333-3333-3333-aaaaaaaaaaa1','6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','6aaaaaaa-2222-2222-2222-aaaaaaaaaaaa','FEFO-1',current_date+20,700,1000,'ACTIVE'),
('6aaaaaaa-3333-3333-3333-aaaaaaaaaaa2','6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','6aaaaaaa-2222-2222-2222-aaaaaaaaaaaa','FEFO-2',current_date+60,800,1200,'ACTIVE'),
('6aaaaaaa-3333-3333-3333-aaaaaaaaaaa3','6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','6aaaaaaa-2222-2222-2222-aaaaaaaaaaaa','EXPIRED',current_date-1,500,500,'EXPIRED')
on conflict(id) do nothing;


create function pg_temp.report_assert(v boolean,label text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'FAILED: %',label; end if; end $$;
update public.products set stock_unit='tablet' where id='6aaaaaaa-2222-2222-2222-aaaaaaaaaaaa';
update public.batches set selling_price=10,purchase_cost=5 where lot_number in ('FEFO-1','FEFO-2');
-- Expiry risk uses the pharmacy business date, independently of the UTC session date.
update public.batches set status='ACTIVE',expiry_date=(statement_timestamp() at time zone 'America/Toronto')::date-1 where lot_number='EXPIRED';
select set_config('request.jwt.claim.sub','66000000-0000-0000-0000-000000000001',true);
do $$
declare org uuid:='6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; br uuid:='6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
 pr uuid:='6aaaaaaa-2222-2222-2222-aaaaaaaaaaaa'; a uuid; b uuid; c uuid; item uuid; rf uuid;
 product uuid; supplier uuid; po uuid; line uuid; n integer;
begin
 insert into public.organization_settings(organization_id,low_stock_default_threshold) values(org,5);
 perform public.post_inventory_movement(org,br,'6aaaaaaa-3333-3333-3333-aaaaaaaaaaa1','PURCHASE_RECEIPT',10,'stock-first','fixture');
 perform public.post_inventory_movement(org,br,'6aaaaaaa-3333-3333-3333-aaaaaaaaaaa2','PURCHASE_RECEIPT',10,'stock-second','fixture');
 perform public.post_inventory_movement(org,br,'6aaaaaaa-3333-3333-3333-aaaaaaaaaaa3','PURCHASE_RECEIPT',2,'stock-expired','fixture');
 a:=public.complete_sale_with_customer(org,br,'YESTERDAY',jsonb_build_array(jsonb_build_object('product_id',pr,'quantity',1)), '[{"method":"CASH","amount":10}]','yesterday');
 b:=public.complete_sale_with_customer(org,br,'TODAY',jsonb_build_array(jsonb_build_object('product_id',pr,'quantity',1)), '[{"method":"CARD","amount":10}]','today');
 c:=public.complete_sale_with_customer(org,br,'FULL',jsonb_build_array(jsonb_build_object('product_id',pr,'quantity',1)), '[{"method":"CASH","amount":10}]','full');
 update public.sales set completed_at='2026-11-18T04:30Z',currency_code='CAD' where id in (a,c);
 update public.sales set completed_at='2026-11-18T05:30Z',currency_code='CAD' where id=b;
 update public.payments set created_at='2026-11-18T04:30Z' where sale_id in (a,c);
 update public.payments set created_at='2026-11-18T05:30Z' where sale_id=b;
 select id into item from public.sale_items where sale_id=a;
 for n in 1..2 loop
   rf:=public.refund_sale(a,'PARTIAL-'||n,jsonb_build_array(jsonb_build_object('sale_item_id',item,'quantity',0.25)),'part-'||n,'partial return');
   update public.sale_refunds set created_at='2026-11-18T06:00Z' where id=rf;
 end loop;
 select id into item from public.sale_items where sale_id=c;
 rf:=public.refund_sale(c,'FULL-REFUND',jsonb_build_array(jsonb_build_object('sale_item_id',item,'quantity',1)),'full-refund','full return');
 update public.sale_refunds set created_at='2026-11-18T07:00Z' where id=rf;
 product:=public.create_catalog_product(org,'{"name":"Two, quoted \"lots\"","stock_unit":"tablet"}');
 perform public.post_opening_stock(org,br,product,'LOW-1',current_date+20,2,1,2,'fixture','low-1');
 perform public.post_opening_stock(org,br,product,'LOW-2',current_date+40,3,1,2,'fixture','low-2');
 product:=public.create_catalog_product(org,'{"name":"Blocked only","stock_unit":"box"}');
 perform public.post_opening_stock(org,br,product,'BLOCKED',current_date+20,9,1,2,'fixture','blocked');
 update public.batches set status='QUARANTINED' where product_id=product;
 product:=public.create_catalog_product(org,'{"name":"Missing values","stock_unit":"bottle"}');
 perform public.post_opening_stock(org,br,product,'MISSING',current_date+20,3,null,2,'fixture','missing-cost');
 update public.batches set selling_price=null where product_id=product;
 product:=public.create_catalog_product(org,'{"name":"Missing balance","stock_unit":"unit"}');
 insert into public.batches(organization_id,branch_id,product_id,lot_number,expiry_date) values(org,br,product,'NO-LEDGER',current_date+20);
 perform public.create_catalog_product(org,'{"name":"No lots","stock_unit":"tube"}');
 insert into public.suppliers(organization_id,name) values(org,'Supplier, Montréal') returning id into supplier;
 po:=public.create_purchase_order(org,br,supplier,'PO-PARTIAL',null,null,jsonb_build_array(jsonb_build_object('product_id',pr,'quantity',10,'unit_cost',2)),'report-po');
 select id into line from public.purchase_order_lines where purchase_order_id=po;
 perform public.receive_purchase_order(po,'RECEIPT-PART',null,jsonb_build_array(jsonb_build_object('purchase_order_line_id',line,'quantity',4,'unit_cost',3,'selling_price',5,'lot_number','PURCHASED','expiry_date',current_date+365)),null,'report-receipt');
 update public.purchase_orders set created_at='2026-11-18T08:00Z' where id=po;
end $$;
set local role authenticated;
do $$
declare org uuid:='6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; br uuid:='6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa'; r jsonb; s jsonb; today date:='2026-11-18';
begin
 r:=public.read_operational_report(org,br,'sales',today,today);
 perform pg_temp.report_assert(r->>'timezone'='America/Toronto','organization zone used');
 perform pg_temp.report_assert((select gross_sales=10 and sale_count=1 from public.report_daily_sales where organization_id=org and branch_id=br and sale_date=today),'Home daily read model shares closeout business date');
 perform pg_temp.report_assert((r#>>'{summary,gross}')::numeric=10 and (r#>>'{summary,sale_count}')::int=1,'UTC boundary excludes previous business day');
 perform pg_temp.report_assert((r#>>'{summary,refunds}')::numeric=15 and (r#>>'{summary,refund_count}')::int=3,'two partial and one full refund use actual amounts and their date');
 perform pg_temp.report_assert((r#>>'{summary,net}')::numeric=-5,'net permits refund-only loss period');
 perform pg_temp.report_assert((r#>>'{summary,recorded_payments}')::numeric=10 and (r#>>'{summary,payment_difference}')::numeric=0,'recorded payments reconcile to daily gross');
 perform pg_temp.report_assert(r#>>'{summary,methods,0,method}'='CARD' and (r#>>'{summary,methods,0,amount}')::numeric=10,'external card summary');
 perform pg_temp.report_assert((r#>>'{summary,units,0,quantity}')::numeric=1,'units from underlying sale items');
 perform pg_temp.report_assert((select sum(total_amount)=10 from public.sales where completed_at>='2026-11-18T05:00Z' and completed_at<'2026-11-19T05:00Z'),'independent sample-day gross reconciliation');
 perform pg_temp.report_assert((select sum(amount)=15 from public.sale_refunds where created_at>='2026-11-18T05:00Z' and created_at<'2026-11-19T05:00Z'),'independent refund reconciliation');
 r:=public.read_operational_report(org,br,'sales',today-1,today-1);
 perform pg_temp.report_assert((r#>>'{summary,gross}')::numeric=20 and (r#>>'{summary,refunds}')::numeric=0,'yesterday retains original sales');
 r:=public.read_operational_report(org,br,'sales',today-2,today-2);
 perform pg_temp.report_assert((r#>>'{summary,gross}')::numeric=0 and jsonb_array_length(r->'rows')=0 and r#>'{summary,average}'='null'::jsonb,'empty day is zero sales with no invented average');
 r:=public.read_operational_report(org,br,'sales',today-1,today);
 perform pg_temp.report_assert((r#>>'{summary,gross}')::numeric=30 and (r#>>'{summary,net}')::numeric=15,'custom period totals');
 r:=public.read_operational_report(org,br,'refunds',today,today);
 perform pg_temp.report_assert((r->>'total')::int=3 and r#>>'{rows,0,sale_number}' is not null,'refund rows trace original sale');
 r:=public.read_operational_report(org,br,'inventory',today,today);
 perform pg_temp.report_assert(r#>'{summary,cost_value}'='null'::jsonb and r#>'{summary,retail_value}'='null'::jsonb,'missing values never become confirmed zero valuation');
 perform pg_temp.report_assert((r#>>'{summary,missing_balance}')::int=1 and (r#>>'{summary,missing_cost}')::int=1 and (r#>>'{summary,missing_price}')::int=1,'missing valuation counters');
 r:=public.read_operational_report(org,br,'attention',today,today);
 perform pg_temp.report_assert((r#>>'{summary,low}')::int=1,'split lot product aggregates two batches into one low-stock product');
 perform pg_temp.report_assert((r#>>'{summary,no_sellable}')::int=2 and (r#>>'{summary,out}')::int=1 and (r#>>'{summary,unknown}')::int=1,'blocked, out and unknown attention');
 r:=public.read_operational_report(org,br,'expiry',today,today,'','expired');
 perform pg_temp.report_assert((r->>'total')::int=1 and r#>>'{rows,0,status}'='ACTIVE' and r#>>'{rows,0,risk}'='expired','actual expired date wins over stored status');
 perform pg_temp.report_assert((r#>>'{summary,missing_balance}')::int=0,'expiry completeness warnings apply only to filtered rows');
 r:=public.read_operational_report(org,br,'expiry',today,today,'','near','',7);
 perform pg_temp.report_assert((r->>'total')::int=0,'configurable expiry horizon');
 r:=public.read_operational_report(org,br,'purchasing',today,today,'','','Supplier,');
 perform pg_temp.report_assert((r#>>'{summary,partial}')::int=1 and (r#>>'{summary,ordered_value}')::numeric=20 and (r#>>'{summary,received_value}')::numeric=12 and (r#>>'{summary,outstanding_value}')::numeric=12,'partial PO: order cost 2, actual receipt cost 3, outstanding estimate 12');
 r:=public.read_operational_report(org,br,'movements',current_date-1,current_date+1,'LOW-1','ADJUSTMENT_IN');
 perform pg_temp.report_assert((r->>'total')::int=1 and r#>>'{rows,0,lot_number}'='LOW-1','query-backed lot and movement type filters');
 r:=public.read_operational_report(org,br,'counts',today,today);
 perform pg_temp.report_assert((r->>'total')::int=0,'empty count report');
 r:=public.read_operational_report(org,br,'transfers',today,today);
 perform pg_temp.report_assert((r->>'total')::int=0,'empty transfer report');
end $$;
reset role;
-- Nonempty counts and mixed-unit transfers reuse the existing workers/details.
do $$
declare org uuid:='6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; br uuid:='6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
 second uuid:='6aaaaaaa-1111-1111-1111-aaaaaaaaaaa2'; cnt uuid; tr uuid; ba uuid; bb uuid; r jsonb;
begin
 insert into public.branches(id,organization_id,name,timezone) values(second,org,'Second','UTC');
 insert into public.branch_memberships(branch_id,organization_membership_id) values(second,'6a100000-0000-0000-0000-000000000001');
 select id into ba from public.batches where lot_number='LOW-1';
 select id into bb from public.batches where lot_number='MISSING';
 insert into public.inventory_stock_counts(organization_id,branch_id,notes,created_at) values(org,br,'Shelf count','2026-11-18T08:00Z') returning id into cnt;
 insert into public.inventory_stock_count_lines(stock_count_id,organization_id,branch_id,batch_id,expected_quantity,counted_quantity) values(cnt,org,br,ba,2,1);
 perform public.complete_inventory_stock_count(cnt);
 tr:=public.create_stock_transfer(org,br,second,'TRANSFER-MIXED',jsonb_build_array(jsonb_build_object('source_batch_id','6aaaaaaa-3333-3333-3333-aaaaaaaaaaa1','quantity',2),jsonb_build_object('source_batch_id',bb,'quantity',1)),'report-transfer');
 update public.stock_transfers set requested_at='2026-11-18T08:00Z' where id=tr;
end $$;
set local role authenticated;
do $$
declare org uuid:='6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; br uuid:='6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa'; r jsonb;
begin
 r:=public.read_operational_report(org,br,'counts','2026-11-18','2026-11-18');
 perform pg_temp.report_assert((r->>'total')::int=1 and r#>>'{rows,0,status}'='COMPLETED','completed count is inspectable');
 r:=public.read_operational_report(org,br,'movements',current_date-1,current_date+1,'','COUNT_CORRECTION_OUT');
 perform pg_temp.report_assert((r->>'total')::int=1 and r#>>'{rows,0,reference_type}'='STOCK_COUNT' and (r#>>'{rows,0,quantity_delta}')::numeric=-1,'variance traces reconciliation ledger movement');
 r:=public.read_operational_report(org,br,'transfers','2026-11-18','2026-11-18');
 perform pg_temp.report_assert((r->>'total')::int=1 and (r#>>'{rows,0,lines}')::int=2 and not (r#>'{rows,0}' ? 'requested'),'mixed tablet/bottle transfer uses line counts rather than meaningless summed quantities');
 r:=public.read_operational_report(org,'6aaaaaaa-1111-1111-1111-aaaaaaaaaaa2','sales','2026-11-18','2026-11-18');
 perform pg_temp.report_assert(r->>'timezone'='UTC' and (r#>>'{summary,sale_count}')::int=0,'selected branch timezone overrides organization and its period is independent');
end $$;
reset role;
-- Large history stays server-aggregated while every response has at most 25 rows.
insert into public.sales(organization_id,branch_id,sale_number,total_amount,currency_code,idempotency_key,completed_at,created_by)
select '6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','HISTORY-'||n,1,'CAD','history-'||n,'2026-11-18T09:00Z','66000000-0000-0000-0000-000000000001' from generate_series(1,130)n;
set local role authenticated;
do $$
declare r jsonb; r2 jsonb; org uuid:='6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; br uuid:='6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
begin
 r:=public.read_operational_report(org,br,'sales','2026-11-18','2026-11-18');
 r2:=public.read_operational_report(org,br,'sales','2026-11-18','2026-11-18','','','',30,5);
 perform pg_temp.report_assert((r->>'total')::int=131 and jsonb_array_length(r->'rows')=25 and jsonb_array_length(r2->'rows')=6,'history over 100 is paginated without a summary ceiling');
 perform pg_temp.report_assert(r->'summary'=r2->'summary' and (r#>>'{summary,gross}')::numeric=140,'headline totals independent of page');
 perform pg_temp.report_assert((r#>>'{summary,missing_sale_items}')::int=130,'incomplete historical item records are explicitly disclosed');
 perform pg_temp.report_assert(not exists(select 1 from jsonb_array_elements(r->'rows')a join jsonb_array_elements(r2->'rows')b on a->>'id'=b->>'id'),'stable pagination has no repeated IDs');
end $$;
reset role;
update public.sales set completed_at='2026-11-17T09:00Z' where sale_number like 'HISTORY-%';
rollback;
