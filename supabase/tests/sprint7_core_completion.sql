-- Sprint 7 core completion regression tests. Run only on an isolated database; rolled back.
begin;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) values
('77000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7-owner-a@test.invalid','',now(),now(),now(),'{}','{}'),
('77000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7-owner-b@test.invalid','',now(),now(),now(),'{}','{}')
on conflict(id) do nothing;
insert into public.organizations(id,name,slug) values
('77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Sprint 7 Pharmacy A','s7-pharmacy-a'),
('77bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Sprint 7 Pharmacy B','s7-pharmacy-b') on conflict(id) do nothing;
insert into public.branches(id,organization_id,name,code) values
('77aaaaaa-1111-1111-1111-aaaaaaaaaaaa','77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Main A','MAIN'),
('77bbbbbb-1111-1111-1111-bbbbbbbbbbbb','77bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Main B','MAIN') on conflict(id) do nothing;
insert into public.organization_memberships(id,organization_id,user_id,role_id,status) values
('77100000-0000-0000-0000-000000000001','77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','77000000-0000-0000-0000-000000000001',(select id from public.roles where organization_id is null and code='OWNER'),'active'),
('77100000-0000-0000-0000-000000000002','77bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','77000000-0000-0000-0000-000000000002',(select id from public.roles where organization_id is null and code='OWNER'),'active') on conflict(id) do nothing;
insert into public.branch_memberships(branch_id,organization_membership_id) values
('77aaaaaa-1111-1111-1111-aaaaaaaaaaaa','77100000-0000-0000-0000-000000000001'),
('77bbbbbb-1111-1111-1111-bbbbbbbbbbbb','77100000-0000-0000-0000-000000000002') on conflict do nothing;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','77000000-0000-0000-0000-000000000001',true);

insert into public.customers(id,organization_id,full_name,phone,preferred_locale) values('77aaaaaa-2222-2222-2222-aaaaaaaaaaaa','77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Customer A','+22997000001','fr');
insert into public.organization_settings(organization_id,receipt_footer,default_payment_method,low_stock_default_threshold) values('77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Merci','MOBILE_MONEY',7);

do $$ begin
 if (select count(*) from public.customers where organization_id='77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')<>1 then raise exception 'S7-T-001 customer create/read failed'; end if;
 if (select default_payment_method from public.organization_settings where organization_id='77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')<>'MOBILE_MONEY' then raise exception 'S7-T-002 settings save failed'; end if;
end $$;

insert into public.import_jobs(id,organization_id,branch_id,import_type,file_name,status,total_rows,valid_rows) values('77aaaaaa-3333-3333-3333-aaaaaaaaaaaa','77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','77aaaaaa-1111-1111-1111-aaaaaaaaaaaa','PRODUCTS','products.csv','READY',1,1);
insert into public.import_rows(import_job_id,organization_id,row_number,raw_data,normalized_data,status) values('77aaaaaa-3333-3333-3333-aaaaaaaaaaaa','77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',2,'{"name":"Imported Product","sku":"S7-001"}','{"name":"Imported Product","sku":"S7-001"}','VALID');
select public.commit_import_job('77aaaaaa-3333-3333-3333-aaaaaaaaaaaa');

do $$ begin
 if not exists(select 1 from public.products where organization_id='77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and sku='S7-001') then raise exception 'S7-T-003 product import failed'; end if;
 if (select status from public.import_jobs where id='77aaaaaa-3333-3333-3333-aaaaaaaaaaaa')<>'COMPLETED' then raise exception 'S7-T-004 product import status failed'; end if;
end $$;

insert into public.import_jobs(id,organization_id,branch_id,import_type,file_name,status,total_rows,valid_rows) values('77aaaaaa-4444-4444-4444-aaaaaaaaaaaa','77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','77aaaaaa-1111-1111-1111-aaaaaaaaaaaa','OPENING_STOCK','stock.csv','READY',1,1);
insert into public.import_rows(import_job_id,organization_id,row_number,raw_data,normalized_data,status) values('77aaaaaa-4444-4444-4444-aaaaaaaaaaaa','77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',2,'{}',jsonb_build_object('sku','S7-001','lot_number','S7-LOT','expiry_date',(current_date+5)::text,'quantity','10','purchase_cost','600','selling_price','1000'),'VALID');
select public.commit_import_job('77aaaaaa-4444-4444-4444-aaaaaaaaaaaa');

do $$ begin
 if coalesce((select on_hand_quantity from public.inventory_balances ib join public.batches b on b.id=ib.batch_id where b.organization_id='77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and b.lot_number='S7-LOT'),0)<>10 then raise exception 'S7-T-005 opening stock import failed'; end if;
end $$;

select public.complete_sale_with_customer(
 '77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','77aaaaaa-1111-1111-1111-aaaaaaaaaaaa','SALE-S7-001',
 jsonb_build_array(jsonb_build_object('product_id',(select id from public.products where organization_id='77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and sku='S7-001'),'quantity',2)),
 jsonb_build_array(jsonb_build_object('method','CASH','amount',2000)),'s7:sale:001','customer sale','77aaaaaa-2222-2222-2222-aaaaaaaaaaaa');

do $$ begin
 if (select customer_id from public.sales where sale_number='SALE-S7-001')<>'77aaaaaa-2222-2222-2222-aaaaaaaaaaaa'::uuid then raise exception 'S7-T-006 customer sale association failed'; end if;
 if coalesce((select gross_sales from public.report_daily_sales where organization_id='77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and branch_id='77aaaaaa-1111-1111-1111-aaaaaaaaaaaa' order by sale_date desc limit 1),0)<>2000 then raise exception 'S7-T-007 sales report failed'; end if;
 if coalesce((select inventory_cost_value from public.report_inventory_value where organization_id='77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and branch_id='77aaaaaa-1111-1111-1111-aaaaaaaaaaaa'),0)<>4800 then raise exception 'S7-T-008 inventory value report failed'; end if;
end $$;

select public.refresh_expiry_alerts('77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','77aaaaaa-1111-1111-1111-aaaaaaaaaaaa');
do $$ begin
 if not exists(select 1 from public.notifications where organization_id='77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and recipient_user_id='77000000-0000-0000-0000-000000000001' and type='EXPIRY_ALERT') then raise exception 'S7-T-009 expiry notification fanout failed'; end if;
 if not exists(select 1 from public.audit_logs where organization_id='77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and entity_type='customers') then raise exception 'S7-T-010 customer audit event missing'; end if;
 if not exists(select 1 from public.subscription_plans where code='CORE_35000' and monthly_price=35000) then raise exception 'S7-T-011 subscription plan missing'; end if;
end $$;

select set_config('request.jwt.claim.sub','77000000-0000-0000-0000-000000000002',true);
do $$ begin
 if exists(select 1 from public.customers where organization_id='77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') then raise exception 'S7-T-012 tenant customer isolation failed'; end if;
 if exists(select 1 from public.import_jobs where organization_id='77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') then raise exception 'S7-T-013 tenant import isolation failed'; end if;
end $$;

reset role;
do $$ declare v_id bigint; begin
 select id into v_id from public.audit_logs where organization_id='77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' limit 1;
 begin update public.audit_logs set event_type='tampered' where id=v_id; raise exception 'S7-T-014 audit mutation was allowed'; exception when object_not_in_prerequisite_state then null; end;
end $$;

rollback;
