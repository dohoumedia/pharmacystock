-- Catalog/opening-stock functional package. Authored and tested locally only.
-- Requirement references: INV-FR-001..004, BAT-FR-001..002, STK-FR-001..003, BR-018.
-- No existing balances, ledger history, purchase costs or authorization policies are rewritten.
alter table public.products add column stock_unit text not null default 'unit';
alter table public.products add constraint products_stock_unit_code check
  (stock_unit in ('unit','tablet','capsule','bottle','box','ampoule','tube','sachet','ml','g'));
comment on column public.products.stock_unit is 'Unit counted by all inventory quantities. package_size is descriptive; no automatic pack conversion.';

create function app_private.guard_product_stock_unit() returns trigger
language plpgsql security definer set search_path=public,app_private,pg_temp as $$
begin
  if new.stock_unit is distinct from old.stock_unit then
    perform pg_advisory_xact_lock(hashtextextended('stock-unit:'||old.organization_id::text||':'||old.id::text,0));
    if exists(select 1 from public.batches b join public.inventory_movements m
      on m.organization_id=b.organization_id and m.batch_id=b.id
      where b.organization_id=old.organization_id and b.product_id=old.id) then
      raise exception using errcode='23514',message='STOCK_UNIT_LOCKED';
    end if;
  end if;
  return new;
end $$;
revoke all on function app_private.guard_product_stock_unit() from public,anon,authenticated;
create trigger products_stock_unit_guard before update of stock_unit on public.products
for each row execute function app_private.guard_product_stock_unit();

create function app_private.lock_movement_stock_unit() returns trigger
language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_product uuid;
begin
  select product_id into v_product from public.batches where id=new.batch_id and organization_id=new.organization_id;
  if v_product is not null then
    perform pg_advisory_xact_lock(hashtextextended('stock-unit:'||new.organization_id::text||':'||v_product::text,0));
  end if;
  return new;
end $$;
revoke all on function app_private.lock_movement_stock_unit() from public,anon,authenticated;
create trigger inventory_movements_stock_unit_lock before insert on public.inventory_movements
for each row execute function app_private.lock_movement_stock_unit();

create function public.create_catalog_product(p_organization_id uuid,p_product jsonb) returns uuid
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  if coalesce(trim(p_product->>'name'),'')='' then raise exception using errcode='23514',message='PRODUCT_NAME_REQUIRED'; end if;
  insert into public.products(organization_id,name,generic_name,brand_name,strength,dosage_form,package_size,sku,category_id,manufacturer_id,stock_unit)
  values(p_organization_id,trim(p_product->>'name'),nullif(trim(p_product->>'generic_name'),''),nullif(trim(p_product->>'brand_name'),''),
    nullif(trim(p_product->>'strength'),''),nullif(trim(p_product->>'dosage_form'),''),nullif(trim(p_product->>'package_size'),''),nullif(trim(p_product->>'sku'),''),
    nullif(p_product->>'category_id','')::uuid,nullif(p_product->>'manufacturer_id','')::uuid,coalesce(nullif(p_product->>'stock_unit',''),'unit')) returning id into v_id;
  if nullif(trim(p_product->>'barcode'),'') is not null then
    insert into public.product_barcodes(organization_id,product_id,barcode,is_primary) values(p_organization_id,v_id,trim(p_product->>'barcode'),true);
  end if;
  return v_id;
end $$;
revoke all on function public.create_catalog_product(uuid,jsonb) from public,anon;
grant execute on function public.create_catalog_product(uuid,jsonb) to authenticated;

-- The existing unique barcode store and its policies remain authoritative.
create function public.maintain_product_barcode(p_organization_id uuid,p_product_id uuid,p_action text,
  p_barcode text default null,p_barcode_id uuid default null)
returns setof public.product_barcodes language plpgsql security invoker set search_path=public,app_private,pg_temp as $$
declare v_id uuid; v_primary boolean; v_existing_product uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if not app_private.has_permission(p_organization_id,'inventory.product.update') then
    raise exception using errcode='42501',message='PRODUCT_UPDATE_FORBIDDEN'; end if;
  perform 1 from public.products where id=p_product_id and organization_id=p_organization_id;
  if not found then raise exception using errcode='P0002',message='PRODUCT_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('barcode:'||p_organization_id::text||':'||p_product_id::text,0));
  if p_action='ADD' then
    if coalesce(trim(p_barcode),'')='' then raise exception using errcode='23514',message='BARCODE_REQUIRED'; end if;
    select product_id,id into v_existing_product,v_id from public.product_barcodes
      where organization_id=p_organization_id and barcode=trim(p_barcode);
    if v_existing_product is not null and v_existing_product<>p_product_id then
      raise exception using errcode='23505',message='BARCODE_ALREADY_EXISTS';
    end if;
    if v_id is null then
      insert into public.product_barcodes(organization_id,product_id,barcode,is_primary)
      values(p_organization_id,p_product_id,trim(p_barcode),not exists(select 1 from public.product_barcodes
        where organization_id=p_organization_id and product_id=p_product_id));
    end if;
  elsif p_action in ('REMOVE','PRIMARY') then
    select id,is_primary into v_id,v_primary from public.product_barcodes
      where id=p_barcode_id and organization_id=p_organization_id and product_id=p_product_id;
    if v_id is null then raise exception using errcode='P0002',message='BARCODE_NOT_FOUND'; end if;
    if p_action='REMOVE' then
      delete from public.product_barcodes where id=v_id and organization_id=p_organization_id and product_id=p_product_id;
      if v_primary then
        update public.product_barcodes set is_primary=true where id=(select id from public.product_barcodes
          where organization_id=p_organization_id and product_id=p_product_id order by created_at,id limit 1);
      end if;
    else
      update public.product_barcodes set is_primary=false where organization_id=p_organization_id and product_id=p_product_id and is_primary;
      update public.product_barcodes set is_primary=true where id=v_id and organization_id=p_organization_id and product_id=p_product_id;
    end if;
  else raise exception using errcode='23514',message='BARCODE_ACTION_INVALID';
  end if;
  return query select * from public.product_barcodes where organization_id=p_organization_id and product_id=p_product_id
    order by is_primary desc,created_at,id;
exception when unique_violation then
  raise exception using errcode='23505',message='BARCODE_ALREADY_EXISTS';
end $$;
revoke all on function public.maintain_product_barcode(uuid,uuid,text,text,uuid) from public,anon;
grant execute on function public.maintain_product_barcode(uuid,uuid,text,text,uuid) to authenticated;
create trigger product_barcodes_catalog_audit after insert or update or delete on public.product_barcodes
for each row execute function app_private.audit_catalog_change();

-- Invoker read functions support server-side filters and PostgREST range pagination.
create function public.search_catalog_products(p_organization_id uuid,p_search text default '',p_status text default 'active')
returns setof public.products language sql stable security invoker set search_path=public,pg_temp as $$
 select p.* from public.products p where p.organization_id=p_organization_id
 and (p_status is null or p.status=p_status)
 and (coalesce(trim(p_search),'')='' or concat_ws(' ',p.name,p.generic_name,p.brand_name,p.sku,p.strength) ilike '%'||trim(p_search)||'%'
   or exists(select 1 from public.product_barcodes bc where bc.organization_id=p.organization_id and bc.product_id=p.id and bc.barcode ilike '%'||trim(p_search)||'%')
   or exists(select 1 from public.manufacturers mf where mf.organization_id=p.organization_id and mf.id=p.manufacturer_id and mf.name ilike '%'||trim(p_search)||'%'))
 order by p.name,p.id
$$;
create function public.search_catalog_batches(p_organization_id uuid,p_branch_id uuid,p_search text default '')
returns setof public.batches language sql stable security invoker set search_path=public,pg_temp as $$
 select b.* from public.batches b where b.organization_id=p_organization_id and b.branch_id=p_branch_id
 and (coalesce(trim(p_search),'')='' or b.lot_number ilike '%'||trim(p_search)||'%'
   or b.product_id in(select id from public.search_catalog_products(p_organization_id,p_search,null)))
 order by b.expiry_date,b.id
$$;
create function public.search_inventory_stock(p_organization_id uuid,p_branch_id uuid,p_search text default '')
returns setof public.inventory_balances language sql stable security invoker set search_path=public,pg_temp as $$
 select ib.* from public.inventory_balances ib where ib.organization_id=p_organization_id and ib.branch_id=p_branch_id
 and (coalesce(trim(p_search),'')='' or ib.batch_id in(select id from public.search_catalog_batches(p_organization_id,p_branch_id,p_search)))
 order by ib.batch_id
$$;
revoke all on function public.search_catalog_products(uuid,text,text),public.search_catalog_batches(uuid,uuid,text),public.search_inventory_stock(uuid,uuid,text) from public,anon;
grant execute on function public.search_catalog_products(uuid,text,text),public.search_catalog_batches(uuid,uuid,text),public.search_inventory_stock(uuid,uuid,text) to authenticated;

create function public.post_opening_stock(p_organization_id uuid,p_branch_id uuid,p_product_id uuid,p_lot_number text,
 p_expiry_date date,p_quantity numeric,p_purchase_cost numeric,p_selling_price numeric,p_reason text,p_idempotency_key text)
returns uuid language plpgsql security invoker set search_path=public,app_private,pg_temp as $$
declare v_batch public.batches%rowtype; v_prior public.inventory_movements%rowtype; v_payload jsonb; v_movement uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if not app_private.is_org_member(p_organization_id) or not app_private.has_permission(p_organization_id,'inventory.adjust') then
    raise exception using errcode='42501',message='INVENTORY_ADJUST_FORBIDDEN'; end if;
  if not app_private.has_branch_access(p_branch_id) or not exists(select 1 from public.branches where id=p_branch_id and organization_id=p_organization_id and status='active') then
    raise exception using errcode='42501',message='BRANCH_ACCESS_DENIED'; end if;
  if coalesce(trim(p_idempotency_key),'')='' then raise exception using errcode='23514',message='IDEMPOTENCY_KEY_REQUIRED'; end if;
  if coalesce(trim(p_lot_number),'')='' or p_expiry_date is null or not isfinite(p_expiry_date) then
    raise exception using errcode='23514',message='OPENING_STOCK_BATCH_REQUIRED'; end if;
  if p_quantity is null or p_quantity<=0 or p_quantity::text in ('NaN','Infinity','-Infinity') or round(p_quantity,4)<>p_quantity then
    raise exception using errcode='23514',message='OPENING_STOCK_QUANTITY_INVALID'; end if;
  if p_purchase_cost is not null and (p_purchase_cost<0 or p_purchase_cost::text in ('NaN','Infinity','-Infinity') or round(p_purchase_cost,2)<>p_purchase_cost) then
    raise exception using errcode='23514',message='OPENING_STOCK_COST_INVALID'; end if;
  if p_selling_price is null or p_selling_price<=0 or p_selling_price::text in ('NaN','Infinity','-Infinity') or round(p_selling_price,2)<>p_selling_price then
    raise exception using errcode='23514',message='INVALID_BATCH_SELLING_PRICE'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception using errcode='23514',message='INVENTORY_REASON_REQUIRED'; end if;
  v_payload:=jsonb_build_object('branch_id',p_branch_id,'product_id',p_product_id,'lot_number',trim(p_lot_number),'expiry_date',p_expiry_date,
    'quantity',p_quantity,'purchase_cost',p_purchase_cost,'selling_price',p_selling_price,'reason',trim(p_reason));
  perform pg_advisory_xact_lock(hashtextextended('opening-key:'||p_organization_id::text||':'||p_idempotency_key,0));
  select * into v_prior from public.inventory_movements where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.reference_type is distinct from 'OPENING_STOCK' or v_prior.metadata->'opening_stock' is distinct from v_payload then
      raise exception using errcode='23514',message='IDEMPOTENCY_PAYLOAD_MISMATCH'; end if;
    return v_prior.batch_id;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('stock-unit:'||p_organization_id::text||':'||p_product_id::text,0));
  perform 1 from public.products where id=p_product_id and organization_id=p_organization_id and status='active';
  if not found then raise exception using errcode='P0002',message='PRODUCT_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('opening-lot:'||p_organization_id::text||':'||p_branch_id::text||':'||p_product_id::text||':'||trim(p_lot_number),0));
  select * into v_batch from public.batches where organization_id=p_organization_id and branch_id=p_branch_id and product_id=p_product_id and lot_number=trim(p_lot_number) for update;
  if found then
    if v_batch.expiry_date is distinct from p_expiry_date or v_batch.purchase_cost is distinct from p_purchase_cost or v_batch.selling_price is distinct from p_selling_price then
      raise exception using errcode='23514',message='OPENING_STOCK_BATCH_MISMATCH'; end if;
    if v_batch.status not in ('ACTIVE','EXPIRED') then raise exception using errcode='23514',message='INVENTORY_BATCH_STATUS_BLOCKS_INBOUND'; end if;
  else
    insert into public.batches(organization_id,branch_id,product_id,lot_number,expiry_date,purchase_cost,selling_price,status)
    values(p_organization_id,p_branch_id,p_product_id,trim(p_lot_number),p_expiry_date,p_purchase_cost,p_selling_price,
      case when p_expiry_date<current_date then 'EXPIRED' else 'ACTIVE' end) returning * into v_batch;
  end if;
  v_movement:=public.post_inventory_movement(p_organization_id,p_branch_id,v_batch.id,'ADJUSTMENT_IN',p_quantity,p_idempotency_key,
    trim(p_reason),'OPENING_STOCK',v_batch.id::text,p_purchase_cost,jsonb_build_object('opening_stock',v_payload),now());
  select * into v_prior from public.inventory_movements where id=v_movement and organization_id=p_organization_id;
  if not found or v_prior.batch_id is distinct from v_batch.id or v_prior.reference_type is distinct from 'OPENING_STOCK' or v_prior.metadata->'opening_stock' is distinct from v_payload then
    raise exception using errcode='23514',message='IDEMPOTENCY_PAYLOAD_MISMATCH'; end if;
  return v_batch.id;
end $$;
revoke all on function public.post_opening_stock(uuid,uuid,uuid,text,date,numeric,numeric,numeric,text,text) from public,anon;
grant execute on function public.post_opening_stock(uuid,uuid,uuid,text,date,numeric,numeric,numeric,text,text) to authenticated;

-- Preserve existing import jobs/results. Every staged row is now visited; unfinished
-- validation is an explicit row error rather than disappearing from the loop.
create or replace function public.commit_import_job(p_import_job_id uuid)
returns integer language plpgsql security invoker set search_path=public,app_private,pg_temp as $$
declare v_job public.import_jobs%rowtype; v_row record; v_count integer:=0; v_product uuid; v_batch uuid; v_matches integer;
begin
 select * into v_job from public.import_jobs where id=p_import_job_id for update;
 if not found then raise exception using errcode='P0002',message='IMPORT_JOB_NOT_FOUND'; end if;
 if not app_private.has_permission(v_job.organization_id,'import.manage') then raise exception using errcode='42501',message='IMPORT_FORBIDDEN'; end if;
 if v_job.status='COMPLETED' then return v_job.valid_rows; end if;
 if v_job.status not in ('READY','FAILED') then raise exception using errcode='23514',message='IMPORT_JOB_NOT_READY'; end if;
 update public.import_jobs set status='COMMITTING',error_summary='{}'::jsonb where id=v_job.id;
 for v_row in select * from public.import_rows where import_job_id=v_job.id and organization_id=v_job.organization_id and status<>'IMPORTED' order by row_number loop
  begin
   if v_row.status='INVALID' then continue; end if;
   if v_row.status<>'VALID' then raise exception using errcode='23514',message='IMPORT_ROW_NOT_VALIDATED'; end if;
   if v_job.import_type='PRODUCTS' then
    v_product:=public.create_catalog_product(v_job.organization_id,v_row.normalized_data);
   elsif v_job.import_type='SUPPLIERS' then
    if not app_private.has_permission(v_job.organization_id,'purchase.create') then raise exception 'SUPPLIER_IMPORT_FORBIDDEN'; end if;
    if coalesce(trim(v_row.normalized_data->>'name'),'')='' then raise exception 'IMPORT_NAME_REQUIRED'; end if;
    insert into public.suppliers(organization_id,name,code,phone,email,address)
    values(v_job.organization_id,trim(v_row.normalized_data->>'name'),nullif(trim(v_row.normalized_data->>'code'),''),nullif(trim(v_row.normalized_data->>'phone'),''),nullif(trim(v_row.normalized_data->>'email'),''),nullif(trim(v_row.normalized_data->>'address'),''))
    on conflict(organization_id,name) do update set phone=excluded.phone,email=excluded.email,address=excluded.address;
   elsif v_job.import_type='CUSTOMERS' then
    if not app_private.has_permission(v_job.organization_id,'customer.manage') then raise exception 'CUSTOMER_IMPORT_FORBIDDEN'; end if;
    if coalesce(trim(v_row.normalized_data->>'name'),'')='' then raise exception 'IMPORT_NAME_REQUIRED'; end if;
    insert into public.customers(organization_id,full_name,phone,email,preferred_locale,notes)
    values(v_job.organization_id,trim(v_row.normalized_data->>'name'),nullif(trim(v_row.normalized_data->>'phone'),''),nullif(trim(v_row.normalized_data->>'email'),''),case when lower(v_row.normalized_data->>'locale')='en' then 'en' else 'fr' end,nullif(trim(v_row.normalized_data->>'notes'),''));
   elsif v_job.import_type='OPENING_STOCK' then
    select count(*),min(id::text)::uuid into v_matches,v_product from public.products p
    where p.organization_id=v_job.organization_id and p.status='active' and
      ((nullif(v_row.normalized_data->>'product_id','') is not null and p.id::text=v_row.normalized_data->>'product_id')
      or (nullif(v_row.normalized_data->>'sku','') is not null and p.sku=v_row.normalized_data->>'sku')
      or exists(select 1 from public.product_barcodes bc where bc.organization_id=p.organization_id and bc.product_id=p.id and bc.barcode=nullif(v_row.normalized_data->>'barcode','')));
    if v_matches<>1 then raise exception using errcode='23514',message='OPENING_STOCK_PRODUCT_NOT_FOUND'; end if;
    -- Supplied identifiers must all designate the same product; do not guess.
    if (nullif(v_row.normalized_data->>'product_id','') is not null and v_product::text<>v_row.normalized_data->>'product_id')
      or (nullif(v_row.normalized_data->>'sku','') is not null and not exists(select 1 from public.products where id=v_product and sku=v_row.normalized_data->>'sku'))
      or (nullif(v_row.normalized_data->>'barcode','') is not null and not exists(select 1 from public.product_barcodes where organization_id=v_job.organization_id and product_id=v_product and barcode=v_row.normalized_data->>'barcode')) then
      raise exception using errcode='23514',message='OPENING_STOCK_PRODUCT_IDENTITY_MISMATCH'; end if;
    v_batch:=public.post_opening_stock(v_job.organization_id,v_job.branch_id,v_product,v_row.normalized_data->>'lot_number',
      (v_row.normalized_data->>'expiry_date')::date,(v_row.normalized_data->>'quantity')::numeric,
      nullif(v_row.normalized_data->>'purchase_cost','')::numeric,(v_row.normalized_data->>'selling_price')::numeric,
      coalesce(nullif(trim(v_row.normalized_data->>'reason'),''),'Opening stock import'),'opening-import:'||v_job.id::text||':'||v_row.id::text);
   end if;
   update public.import_rows set status='IMPORTED',errors='[]'::jsonb where id=v_row.id; v_count:=v_count+1;
  exception when others then update public.import_rows set status='INVALID',errors=jsonb_build_array(sqlerrm) where id=v_row.id;
  end;
 end loop;
 update public.import_jobs set status=case when exists(select 1 from public.import_rows where import_job_id=v_job.id and status<>'IMPORTED') then 'FAILED' else 'COMPLETED' end,
 total_rows=(select count(*) from public.import_rows where import_job_id=v_job.id),
 valid_rows=(select count(*) from public.import_rows where import_job_id=v_job.id and status='IMPORTED'),
 invalid_rows=(select count(*) from public.import_rows where import_job_id=v_job.id and status<>'IMPORTED'),completed_at=now() where id=v_job.id;
 return v_count;
end $$;
