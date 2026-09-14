-- Batch selling-price foundation regression tests.
-- Run only against an isolated/local Supabase test database. Everything is rolled back.

begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values
('bf000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','batch-price-owner@test.invalid','',now(),now(),now(),'{}','{}')
on conflict (id) do nothing;

insert into public.organizations(id,name,slug,country_code,currency_code,timezone,default_locale)
values ('bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Batch Price Pharmacy','batch-price-pharmacy','CI','XOF','Africa/Abidjan','fr')
on conflict (id) do nothing;

insert into public.branches(id,organization_id,name,code,country_code,timezone)
values ('bfbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Main','MAIN','CI','Africa/Abidjan')
on conflict (id) do nothing;

insert into public.organization_memberships(id,organization_id,user_id,role_id,status)
values (
  'bfeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bf000000-0000-0000-0000-000000000001',
  (select id from public.roles where organization_id is null and code='OWNER'),'active'
)
on conflict (id) do nothing;

insert into public.branch_memberships(branch_id,organization_membership_id)
values ('bfbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','bfeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')
on conflict do nothing;

insert into public.suppliers(id,organization_id,name,status)
values ('bfcccccc-cccc-cccc-cccc-cccccccccccc','bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Batch Price Supplier','active')
on conflict (id) do nothing;

insert into public.products(id,organization_id,name,status) values
('bfdddddd-dddd-dddd-dddd-dddddddddd01','bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Received Product','active'),
('bfdddddd-dddd-dddd-dddd-dddddddddd02','bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Mixed Price Product','active'),
('bfdddddd-dddd-dddd-dddd-dddddddddd03','bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Unpriced FEFO Product','active'),
('bfdddddd-dddd-dddd-dddd-dddddddddd04','bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Legacy Receipt Product','active')
on conflict (id) do nothing;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','bf000000-0000-0000-0000-000000000001',true);

-- A supplied positive selling price is stored independently from purchase cost.
do $$
declare v_order uuid; v_line uuid; v_receipt uuid; v_retry uuid; v_batch uuid;
begin
  v_order := public.create_purchase_order(
    'bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bfbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','bfcccccc-cccc-cccc-cccc-cccccccccccc',
    'PO-BATCH-PRICE-001',current_date+7,null,
    jsonb_build_array(jsonb_build_object('product_id','bfdddddd-dddd-dddd-dddd-dddddddddd01','quantity',4,'unit_cost',700)),
    'batch-price:po:positive'
  );
  select id into v_line from public.purchase_order_lines where purchase_order_id=v_order;
  v_receipt := public.receive_purchase_order(
    v_order,'RCPT-BATCH-PRICE-001',null,
    jsonb_build_array(jsonb_build_object(
      'purchase_order_line_id',v_line,'quantity',4,'unit_cost',700,'selling_price',1500,
      'lot_number','BATCH-PRICE-001','expiry_date',(current_date+365)::text
    )),null,'batch-price:receipt:positive'
  );
  select batch_id into v_batch from public.purchase_receipt_lines where receipt_id=v_receipt;
  if (select purchase_cost from public.batches where id=v_batch) <> 700 then raise exception 'BSP-T-001 purchase cost changed'; end if;
  if (select selling_price from public.batches where id=v_batch) <> 1500 then raise exception 'BSP-T-002 selling price not stored'; end if;
  if (select on_hand_quantity from public.inventory_balances where batch_id=v_batch) <> 4 then raise exception 'BSP-T-003 receipt stock wrong'; end if;

  v_retry := public.receive_purchase_order(
    v_order,'RCPT-BATCH-PRICE-001',null,
    jsonb_build_array(jsonb_build_object(
      'purchase_order_line_id',v_line,'quantity',4,'unit_cost',700,'selling_price',1500,
      'lot_number','BATCH-PRICE-001','expiry_date',(current_date+365)::text
    )),null,'batch-price:receipt:positive'
  );
  if v_retry <> v_receipt then raise exception 'BSP-T-004 receipt retry returned another ID'; end if;
  if (select on_hand_quantity from public.inventory_balances where batch_id=v_batch) <> 4 then raise exception 'BSP-T-005 receipt retry duplicated stock'; end if;
end $$;

-- Reusing a batch accepts the same price, fills a missing price, but never silently reprices it.
do $$
declare v_order uuid; v_line uuid; v_batch uuid; v_before numeric; v_receipts bigint;
begin
  select id into v_batch from public.batches where organization_id='bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and lot_number='BATCH-PRICE-001';
  v_order := public.create_purchase_order(
    'bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bfbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','bfcccccc-cccc-cccc-cccc-cccccccccccc',
    'PO-BATCH-PRICE-002',current_date+7,null,
    jsonb_build_array(jsonb_build_object('product_id','bfdddddd-dddd-dddd-dddd-dddddddddd01','quantity',2,'unit_cost',710)),
    'batch-price:po:reuse'
  );
  select id into v_line from public.purchase_order_lines where purchase_order_id=v_order;
  perform public.receive_purchase_order(
    v_order,'RCPT-BATCH-PRICE-002',null,
    jsonb_build_array(jsonb_build_object(
      'purchase_order_line_id',v_line,'quantity',2,'unit_cost',710,'selling_price',1500,
      'lot_number','BATCH-PRICE-001','expiry_date',(current_date+365)::text
    )),null,'batch-price:receipt:reuse'
  );
  if (select selling_price from public.batches where id=v_batch) <> 1500 then raise exception 'BSP-T-006 reused batch price changed'; end if;
  if (select purchase_cost from public.batches where id=v_batch) <> 700 then raise exception 'BSP-T-007 reused batch purchase cost semantics changed'; end if;
  if (select on_hand_quantity from public.inventory_balances where batch_id=v_batch) <> 6 then raise exception 'BSP-T-008 reused batch stock wrong'; end if;

  v_order := public.create_purchase_order(
    'bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bfbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','bfcccccc-cccc-cccc-cccc-cccccccccccc',
    'PO-BATCH-PRICE-MISMATCH',current_date+7,null,
    jsonb_build_array(jsonb_build_object('product_id','bfdddddd-dddd-dddd-dddd-dddddddddd01','quantity',1,'unit_cost',700)),
    'batch-price:po:mismatch'
  );
  select id into v_line from public.purchase_order_lines where purchase_order_id=v_order;
  select on_hand_quantity into v_before from public.inventory_balances where batch_id=v_batch;
  select count(*) into v_receipts from public.purchase_receipts where purchase_order_id=v_order;
  begin
    perform public.receive_purchase_order(
      v_order,'RCPT-BATCH-PRICE-MISMATCH',null,
      jsonb_build_array(jsonb_build_object(
        'purchase_order_line_id',v_line,'quantity',1,'unit_cost',700,'selling_price',1600,
        'lot_number','BATCH-PRICE-001','expiry_date',(current_date+365)::text
      )),null,'batch-price:receipt:mismatch'
    );
    raise exception 'BSP-T-009 mismatched price was accepted';
  exception when check_violation then
    if sqlerrm <> 'BATCH_SELLING_PRICE_MISMATCH' then raise; end if;
  end;
  if (select count(*) from public.purchase_receipts where purchase_order_id=v_order) <> v_receipts then raise exception 'BSP-T-010 mismatched receipt persisted'; end if;
  if (select on_hand_quantity from public.inventory_balances where batch_id=v_batch) <> v_before then raise exception 'BSP-T-011 mismatched price changed stock'; end if;
end $$;

-- Omitting selling_price preserves the current deployed receiving contract.
do $$
declare v_order uuid; v_line uuid; v_receipt uuid; v_batch uuid;
begin
  v_order := public.create_purchase_order(
    'bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bfbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','bfcccccc-cccc-cccc-cccc-cccccccccccc',
    'PO-BATCH-PRICE-LEGACY',current_date+7,null,
    jsonb_build_array(jsonb_build_object('product_id','bfdddddd-dddd-dddd-dddd-dddddddddd04','quantity',1,'unit_cost',500)),
    'batch-price:po:legacy'
  );
  select id into v_line from public.purchase_order_lines where purchase_order_id=v_order;
  v_receipt := public.receive_purchase_order(
    v_order,'RCPT-BATCH-PRICE-LEGACY',null,
    jsonb_build_array(jsonb_build_object(
      'purchase_order_line_id',v_line,'quantity',1,'unit_cost',500,
      'lot_number','BATCH-PRICE-LEGACY','expiry_date',(current_date+365)::text
    )),null,'batch-price:receipt:legacy'
  );
  select batch_id into v_batch from public.purchase_receipt_lines where receipt_id=v_receipt;
  if (select selling_price from public.batches where id=v_batch) is not null then raise exception 'BSP-T-012 omitted price was invented'; end if;
  if (select on_hand_quantity from public.inventory_balances where batch_id=v_batch) <> 1 then raise exception 'BSP-T-013 legacy receipt stopped working'; end if;

  v_order := public.create_purchase_order(
    'bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bfbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','bfcccccc-cccc-cccc-cccc-cccccccccccc',
    'PO-BATCH-PRICE-FILL',current_date+7,null,
    jsonb_build_array(jsonb_build_object('product_id','bfdddddd-dddd-dddd-dddd-dddddddddd04','quantity',1,'unit_cost',500)),
    'batch-price:po:fill'
  );
  select id into v_line from public.purchase_order_lines where purchase_order_id=v_order;
  perform public.receive_purchase_order(
    v_order,'RCPT-BATCH-PRICE-FILL',null,
    jsonb_build_array(jsonb_build_object(
      'purchase_order_line_id',v_line,'quantity',1,'unit_cost',500,'selling_price',900,
      'lot_number','BATCH-PRICE-LEGACY','expiry_date',(current_date+365)::text
    )),null,'batch-price:receipt:fill'
  );
  if (select selling_price from public.batches where id=v_batch) <> 900 then raise exception 'BSP-T-014 reused unpriced batch was not priced'; end if;
  if (select on_hand_quantity from public.inventory_balances where batch_id=v_batch) <> 2 then raise exception 'BSP-T-015 reused legacy batch stock wrong'; end if;
end $$;

-- Zero and negative receipt prices fail atomically; the constraint also prevents storing them directly.
do $$
declare v_order uuid; v_line uuid; v_receipts bigint; v_movements bigint;
begin
  v_order := public.create_purchase_order(
    'bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bfbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','bfcccccc-cccc-cccc-cccc-cccccccccccc',
    'PO-BATCH-PRICE-ZERO',current_date+7,null,
    jsonb_build_array(jsonb_build_object('product_id','bfdddddd-dddd-dddd-dddd-dddddddddd01','quantity',2,'unit_cost',700)),
    'batch-price:po:zero'
  );
  select id into v_line from public.purchase_order_lines where purchase_order_id=v_order;
  select count(*) into v_receipts from public.purchase_receipts where purchase_order_id=v_order;
  select count(*) into v_movements from public.inventory_movements where organization_id='bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  begin
    perform public.receive_purchase_order(
      v_order,'RCPT-BATCH-PRICE-ZERO',null,
      jsonb_build_array(jsonb_build_object(
        'purchase_order_line_id',v_line,'quantity',1,'unit_cost',700,'selling_price',0,
        'lot_number','BATCH-PRICE-ZERO','expiry_date',(current_date+365)::text
      )),null,'batch-price:receipt:zero'
    );
    raise exception 'BSP-T-016 zero price was accepted';
  exception when check_violation then
    if sqlerrm <> 'INVALID_BATCH_SELLING_PRICE' then raise; end if;
  end;
  begin
    perform public.receive_purchase_order(
      v_order,'RCPT-BATCH-PRICE-NEGATIVE',null,
      jsonb_build_array(jsonb_build_object(
        'purchase_order_line_id',v_line,'quantity',1,'unit_cost',700,'selling_price',-1,
        'lot_number','BATCH-PRICE-NEGATIVE','expiry_date',(current_date+365)::text
      )),null,'batch-price:receipt:negative'
    );
    raise exception 'BSP-T-017 negative price was accepted';
  exception when check_violation then
    if sqlerrm <> 'INVALID_BATCH_SELLING_PRICE' then raise; end if;
  end;
  if (select count(*) from public.purchase_receipts where purchase_order_id=v_order) <> v_receipts then raise exception 'BSP-T-018 invalid-price receipt persisted'; end if;
  if (select count(*) from public.inventory_movements where organization_id='bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') <> v_movements then raise exception 'BSP-T-019 invalid price changed ledger'; end if;
  if exists(select 1 from public.batches where lot_number in ('BATCH-PRICE-ZERO','BATCH-PRICE-NEGATIVE')) then raise exception 'BSP-T-020 invalid-price batch persisted'; end if;

  begin
    insert into public.batches(organization_id,branch_id,product_id,lot_number,expiry_date,selling_price)
    values('bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bfbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','bfdddddd-dddd-dddd-dddd-dddddddddd01','DIRECT-ZERO',current_date+365,0);
    raise exception 'BSP-T-021 zero-price constraint did not fire';
  exception when check_violation then null;
  end;
  begin
    insert into public.batches(organization_id,branch_id,product_id,lot_number,expiry_date,selling_price)
    values('bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bfbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','bfdddddd-dddd-dddd-dddd-dddddddddd01','DIRECT-NEGATIVE',current_date+365,-1);
    raise exception 'BSP-T-022 negative-price constraint did not fire';
  exception when check_violation then null;
  end;
end $$;

-- Different positive batch prices remain server-authoritative across one FEFO sale.
insert into public.batches(id,organization_id,branch_id,product_id,lot_number,expiry_date,purchase_cost,selling_price,status) values
('bf111111-1111-1111-1111-111111111111','bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bfbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','bfdddddd-dddd-dddd-dddd-dddddddddd02','MIXED-1',current_date+20,700,1500,'ACTIVE'),
('bf222222-2222-2222-2222-222222222222','bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bfbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','bfdddddd-dddd-dddd-dddd-dddddddddd02','MIXED-2',current_date+60,800,1600,'ACTIVE');

select public.post_inventory_movement('bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bfbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','bf111111-1111-1111-1111-111111111111','PURCHASE_RECEIPT',2,'batch-price:seed:mixed:1','seed');
select public.post_inventory_movement('bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bfbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','bf222222-2222-2222-2222-222222222222','PURCHASE_RECEIPT',20,'batch-price:seed:mixed:2','seed');

do $$
declare v_quote jsonb; v_sale uuid; v_retry uuid;
begin
  v_quote := public.quote_sale(
    'bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bfbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    jsonb_build_array(jsonb_build_object('product_id','bfdddddd-dddd-dddd-dddd-dddddddddd02','quantity',5))
  );
  if (v_quote->>'total_amount')::numeric <> 7800 then raise exception 'BSP-T-023 mixed-price quote total wrong'; end if;
  if jsonb_array_length(v_quote->'items') <> 2 then raise exception 'BSP-T-024 mixed-price quote allocation wrong'; end if;
  if (v_quote->'items'->0->>'unit_price')::numeric <> 1500 or (v_quote->'items'->1->>'unit_price')::numeric <> 1600 then raise exception 'BSP-T-025 per-batch quote prices wrong'; end if;

  v_sale := public.complete_sale(
    'bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bfbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','SALE-BATCH-PRICE-001',
    jsonb_build_array(jsonb_build_object('product_id','bfdddddd-dddd-dddd-dddd-dddddddddd02','quantity',5,'unit_price',1)),
    jsonb_build_array(jsonb_build_object('method','CASH','amount',7800)),
    'batch-price:sale:mixed',null
  );
  if (select count(*) from public.sale_items where sale_id=v_sale) <> 2 then raise exception 'BSP-T-026 sale allocations missing'; end if;
  if (select sum(line_total) from public.sale_items where sale_id=v_sale) <> 7800 then raise exception 'BSP-T-027 sale total wrong'; end if;
  if exists(select 1 from public.sale_items where sale_id=v_sale and unit_price not in (1500,1600)) then raise exception 'BSP-T-028 client price was trusted'; end if;
  if coalesce((select on_hand_quantity from public.inventory_balances where batch_id='bf111111-1111-1111-1111-111111111111'),0) <> 0 then raise exception 'BSP-T-029 first FEFO batch not depleted'; end if;
  if coalesce((select on_hand_quantity from public.inventory_balances where batch_id='bf222222-2222-2222-2222-222222222222'),0) <> 17 then raise exception 'BSP-T-030 second FEFO batch balance wrong'; end if;

  v_retry := public.complete_sale(
    'bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bfbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','SALE-BATCH-PRICE-001',
    jsonb_build_array(jsonb_build_object('product_id','bfdddddd-dddd-dddd-dddd-dddddddddd02','quantity',5)),
    jsonb_build_array(jsonb_build_object('method','CASH','amount',7800)),
    'batch-price:sale:mixed',null
  );
  if v_retry <> v_sale then raise exception 'BSP-T-031 sale retry returned another ID'; end if;
  if (select count(*) from public.inventory_movements where reference_id=v_sale::text and movement_type='SALE') <> 2 then raise exception 'BSP-T-032 sale retry duplicated movements'; end if;
end $$;

-- The first FEFO batch blocks quote and checkout when it is unpriced; later priced stock is not skipped.
insert into public.batches(id,organization_id,branch_id,product_id,lot_number,expiry_date,purchase_cost,selling_price,status) values
('bf333333-3333-3333-3333-333333333333','bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bfbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','bfdddddd-dddd-dddd-dddd-dddddddddd03','UNPRICED-FIRST',current_date+10,700,null,'ACTIVE'),
('bf444444-4444-4444-4444-444444444444','bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bfbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','bfdddddd-dddd-dddd-dddd-dddddddddd03','PRICED-SECOND',current_date+30,800,1600,'ACTIVE');

select public.post_inventory_movement('bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bfbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','bf333333-3333-3333-3333-333333333333','PURCHASE_RECEIPT',1,'batch-price:seed:unpriced','seed');
select public.post_inventory_movement('bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bfbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','bf444444-4444-4444-4444-444444444444','PURCHASE_RECEIPT',5,'batch-price:seed:priced','seed');

do $$
declare v_sales bigint; v_movements bigint; v_unpriced numeric; v_priced numeric;
begin
  begin
    perform public.quote_sale(
      'bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bfbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      jsonb_build_array(jsonb_build_object('product_id','bfdddddd-dddd-dddd-dddd-dddddddddd03','quantity',1))
    );
    raise exception 'BSP-T-033 unpriced FEFO quote succeeded';
  exception when check_violation then
    if sqlerrm <> 'SELLING_PRICE_REQUIRED' then raise; end if;
  end;

  select count(*) into v_sales from public.sales where organization_id='bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  select count(*) into v_movements from public.inventory_movements where organization_id='bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  select on_hand_quantity into v_unpriced from public.inventory_balances where batch_id='bf333333-3333-3333-3333-333333333333';
  select on_hand_quantity into v_priced from public.inventory_balances where batch_id='bf444444-4444-4444-4444-444444444444';
  begin
    perform public.complete_sale(
      'bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bfbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','SALE-BATCH-PRICE-UNPRICED',
      jsonb_build_array(jsonb_build_object('product_id','bfdddddd-dddd-dddd-dddd-dddddddddd03','quantity',1)),
      jsonb_build_array(jsonb_build_object('method','CASH','amount',1600)),
      'batch-price:sale:unpriced',null
    );
    raise exception 'BSP-T-034 unpriced FEFO checkout succeeded';
  exception when check_violation then
    if sqlerrm <> 'SELLING_PRICE_REQUIRED' then raise; end if;
  end;
  if (select count(*) from public.sales where organization_id='bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') <> v_sales then raise exception 'BSP-T-035 failed checkout persisted sale'; end if;
  if (select count(*) from public.inventory_movements where organization_id='bfaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') <> v_movements then raise exception 'BSP-T-036 failed checkout changed ledger'; end if;
  if (select on_hand_quantity from public.inventory_balances where batch_id='bf333333-3333-3333-3333-333333333333') <> v_unpriced then raise exception 'BSP-T-037 failed checkout changed first balance'; end if;
  if (select on_hand_quantity from public.inventory_balances where batch_id='bf444444-4444-4444-4444-444444444444') <> v_priced then raise exception 'BSP-T-038 failed checkout changed later balance'; end if;
end $$;

reset role;
rollback;
