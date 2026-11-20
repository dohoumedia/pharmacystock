-- Disposable local fixture only. No hosted operations.
begin;
create function pg_temp.settings_assert(v boolean,label text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'FAILED: %',label; end if; end $$;
set local role authenticated;
set local request.jwt.claim.sub='66000000-0000-0000-0000-000000000001';
do $$
declare org uuid:='6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; br uuid:='6aaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
  pr uuid:='6aaaaaaa-2222-2222-2222-aaaaaaaaaaaa'; v jsonb; sid uuid; po uuid; supplier uuid; total numeric;
begin
  update public.organizations set name='Settings QA Pharmacy',timezone='America/Toronto' where id=org;
  perform pg_temp.settings_assert((select name='Settings QA Pharmacy' from public.organizations where id=org),'profile save/load');
  begin update public.organizations set timezone='Not/AZone' where id=org; raise exception 'invalid timezone accepted';
    exception when sqlstate '22023' then if sqlerrm<>'SETTINGS_TIMEZONE_INVALID' then raise; end if; end;
  begin update public.organizations set currency_code='EUR' where id=org; raise exception 'currency relabeled';
    exception when sqlstate '22023' then if sqlerrm<>'SETTINGS_CURRENCY_LOCKED' then raise; end if; end;
  update public.branches set address_line1='18 Local QA Street',phone='+1 555 0100',email='qa@example.test',timezone='Pacific/Honolulu' where id=br;
  v:=public.read_operational_report(org,br,'inventory',current_date,current_date);
  perform pg_temp.settings_assert(v->>'timezone'='Pacific/Honolulu','branch timezone override consumed by report');
  update public.branches set timezone=null where id=br;
  v:=public.read_operational_report(org,br,'inventory',current_date,current_date);
  perform pg_temp.settings_assert(v->>'timezone'='America/Toronto','organization timezone fallback consumed');
  update public.branches set status='inactive' where id=br;
  perform pg_temp.settings_assert((select status='inactive' from public.branches where id=br),'branch inactive state');
  update public.branches set status='active' where id=br;
  insert into public.organization_settings(organization_id,receipt_footer,default_payment_method,low_stock_default_threshold)
    values(org,'Merci / Thank you','CARD',2.5) on conflict(organization_id) do update set receipt_footer=excluded.receipt_footer,default_payment_method=excluded.default_payment_method,low_stock_default_threshold=excluded.low_stock_default_threshold;
  insert into public.organization_settings(organization_id,receipt_footer,default_payment_method,low_stock_default_threshold)
    values(org,'Merci / Thank you','CARD',2.5) on conflict(organization_id) do update set receipt_footer=excluded.receipt_footer;
  perform pg_temp.settings_assert((select count(*)=1 from public.organization_settings where organization_id=org),'same-record settings retry');
  v:=public.read_operational_report(org,br,'attention',current_date,current_date);
  perform pg_temp.settings_assert((v->'summary'->>'threshold')::numeric=2.5,'report threshold propagation');
  update public.organization_settings set low_stock_default_threshold=500 where organization_id=org;
  v:=public.read_operational_report(org,br,'attention',current_date,current_date);
  perform pg_temp.settings_assert((v->'summary'->>'threshold')::numeric=500,'changed report threshold propagation');
  insert into public.expiry_policies(organization_id,thresholds_days) values(org,array[60,7]) on conflict(organization_id) do update set thresholds_days=excluded.thresholds_days;
  v:=public.read_operational_report(org,br,'expiry',current_date,current_date,'','','',(select max(t) from public.expiry_policies,unnest(thresholds_days)t where organization_id=org));
  perform pg_temp.settings_assert(v is not null,'expiry configured report window');
  v:=public.quote_sale(org,br,jsonb_build_array(jsonb_build_object('product_id',pr,'quantity',1)));
  total:=(v->>'total_amount')::numeric;
  sid:=public.complete_sale_with_customer(org,br,'SETTINGS-QA',jsonb_build_array(jsonb_build_object('product_id',pr,'quantity',1)),jsonb_build_array(jsonb_build_object('method','CARD','amount',total)),'settings-sale',null,null,v,null);
  perform pg_temp.settings_assert((select currency_code='CAD' from public.sales where id=sid),'non-XOF real checkout after configuration migration');
  select id into supplier from public.suppliers where organization_id=org limit 1;
  po:=public.create_purchase_order(org,br,supplier,'SETTINGS-PO',null,null,jsonb_build_array(jsonb_build_object('product_id',pr,'quantity',1,'unit_cost',2)),'settings-po');
  perform pg_temp.settings_assert(po is not null,'real purchasing worker after currency lock trigger');
end; $$;
-- The shared refresh replaces legacy alert-insert fanout. Test the same preference
-- invariant through the current application RPC and batch-scoped condition key.
do $$
declare org uuid:='6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; batch uuid:='6aaaaaaa-3333-3333-3333-aaaaaaaaaaa1'; n integer;
begin
  perform pg_temp.settings_assert(not exists(select 1 from public.notification_preferences where organization_id=org and user_id=auth.uid()),'absent preference fixture');
  perform public.refresh_operational_notifications(org);
  perform pg_temp.settings_assert((select count(*)=1 from public.notifications where recipient_user_id=auth.uid() and condition_key='expiry:'||batch::text and resolved_at is null),'absent preference defaults to enabled');
  insert into public.notification_preferences(organization_id,user_id,in_app) values(org,auth.uid(),false);
  perform public.refresh_operational_notifications(org);
  perform pg_temp.settings_assert(not exists(select 1 from public.notifications where recipient_user_id=auth.uid() and condition_key='expiry:'||batch::text and resolved_at is null),'opted-out recipient gets no active notification');
  select count(*) into n from public.notifications where organization_id=org and recipient_user_id=auth.uid();
  perform public.refresh_operational_notifications(org);
  perform pg_temp.settings_assert((select count(*)=n from public.notifications where organization_id=org and recipient_user_id=auth.uid()),'opted-out refresh creates no new notification');
  update public.notification_preferences set in_app=true where organization_id=org and user_id=auth.uid();
  perform public.refresh_operational_notifications(org);
  perform public.refresh_operational_notifications(org);
  perform pg_temp.settings_assert((select count(*)=1 from public.notifications where recipient_user_id=auth.uid() and condition_key='expiry:'||batch::text and resolved_at is null and read_at is null),'enabled preference receives current alert exactly once');
end $$;
reset role;
do $$
begin
  insert into public.organizations(id,name,slug,currency_code,timezone) values('8aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Empty QA','settings-empty','XOF','UTC');
  insert into public.branches(id,organization_id,name) values('8aaaaaaa-1111-1111-1111-aaaaaaaaaaaa','8aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Only Branch');
  begin update public.branches set status='inactive' where id='8aaaaaaa-1111-1111-1111-aaaaaaaaaaaa'; raise exception 'last branch deactivated';
    exception when sqlstate '22023' then if sqlerrm<>'SETTINGS_LAST_BRANCH' then raise; end if; end;
  update public.organizations set currency_code='EUR' where id='8aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  perform pg_temp.settings_assert((select currency_code='EUR' from public.organizations where id='8aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),'unused business currency may be configured');
end; $$;
rollback;
