-- Controlled onboarding; PRD-019. Local-only, no new import subsystem.
-- Existing domain RPCs, RLS, ledger, per-row transactions and history remain authoritative.
create function public.check_import_row(p_organization_id uuid,p_branch_id uuid,p_type text,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path=public,app_private,pg_temp as $$
declare issues jsonb:='[]'; f text; val text; lim integer; prod public.products%rowtype; matches integer; b public.batches%rowtype;
begin
 if not app_private.is_org_member(p_organization_id) or not app_private.has_permission(p_organization_id,'import.manage') then raise exception 'IMPORT_FORBIDDEN'; end if;
 if p_type not in ('PRODUCTS','SUPPLIERS','CUSTOMERS','OPENING_STOCK') or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'IMPORT_INPUT_INVALID'; end if;
 if (p_type='PRODUCTS' and not app_private.has_permission(p_organization_id,'inventory.product.create')) or
    (p_type='SUPPLIERS' and not app_private.has_permission(p_organization_id,'purchase.create')) or
    (p_type='CUSTOMERS' and not app_private.has_permission(p_organization_id,'customer.manage')) or
    (p_type='OPENING_STOCK' and not app_private.has_permission(p_organization_id,'inventory.adjust')) then raise exception 'IMPORT_FORBIDDEN'; end if;
 for f,val in select key,value from jsonb_each_text(p_data) loop
   lim:=case f when 'name' then 160 when 'notes' then 2000 when 'address' then 500 when 'email' then 254 when 'phone' then 40 else 200 end;
   if length(val)>lim or val ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]' then issues:=issues||jsonb_build_array(jsonb_build_object('code','IMPORT_FIELD_LENGTH','field',f)); end if;
 end loop;
 if p_type<>'OPENING_STOCK' and coalesce(trim(p_data->>'name'),'')='' then issues:=issues||'[{"code":"IMPORT_NAME_REQUIRED","field":"name"}]'; end if;
 if coalesce(p_data->>'email','')<>'' and (p_data->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then issues:=issues||'[{"code":"IMPORT_EMAIL","field":"email"}]'; end if;
 if coalesce(p_data->>'phone','')<>'' and ((p_data->>'phone') !~ '^\+?[0-9 ().-]+$' or length(regexp_replace(p_data->>'phone','\D','','g')) not between 5 and 20) then issues:=issues||'[{"code":"IMPORT_PHONE","field":"phone"}]'; end if;
 if coalesce(p_data->>'stock_unit','')<>'' and p_data->>'stock_unit' not in ('unit','tablet','capsule','bottle','box','ampoule','tube','sachet','ml','g') then issues:=issues||'[{"code":"IMPORT_STOCK_UNIT","field":"stock_unit"}]'; end if;
 if p_type='PRODUCTS' then
   if coalesce(p_data->>'barcode','')<>'' and (p_data->>'barcode') !~ '^[!-~]{1,128}$' then issues:=issues||'[{"code":"IMPORT_BARCODE","field":"barcode"}]'; end if;
   -- No product-level pricing exists: never silently discard these values.
   if coalesce(p_data->>'purchase_cost','')<>'' or coalesce(p_data->>'selling_price','')<>'' then issues:=issues||'[{"code":"IMPORT_BATCH_PRICING","field":"selling_price"}]'; end if;
   if exists(select 1 from public.products where organization_id=p_organization_id and (sku=nullif(p_data->>'sku','') or lower(name)=lower(p_data->>'name'))) then issues:=issues||'[{"code":"IMPORT_EXISTING","field":"sku"}]'; end if;
   if exists(select 1 from public.product_barcodes where organization_id=p_organization_id and barcode=nullif(p_data->>'barcode','')) then issues:=issues||'[{"code":"IMPORT_EXISTING","field":"barcode"}]'; end if;
 elsif p_type='SUPPLIERS' then
   if exists(select 1 from public.suppliers s where s.organization_id=p_organization_id and (lower(s.name)=lower(p_data->>'name') or s.code=nullif(p_data->>'code','') or lower(s.email)=lower(nullif(p_data->>'email','')) or (nullif(p_data->>'phone','') is not null and regexp_replace(s.phone,'\D','','g')=regexp_replace(p_data->>'phone','\D','','g')))) then issues:=issues||'[{"code":"IMPORT_EXISTING","field":"name"}]'; end if;
 elsif p_type='CUSTOMERS' then
   if coalesce(p_data->>'locale','')<>'' and p_data->>'locale' not in ('en','fr') then issues:=issues||'[{"code":"IMPORT_LOCALE","field":"locale"}]'; end if;
   if coalesce(p_data->>'status','')<>'' and p_data->>'status' not in ('active','archived') then issues:=issues||'[{"code":"IMPORT_STATUS","field":"status"}]'; end if;
   if exists(select 1 from public.customers c where c.organization_id=p_organization_id and c.status='active' and (lower(c.email)=lower(nullif(p_data->>'email','')) or (nullif(p_data->>'phone','') is not null and regexp_replace(c.phone,'\D','','g')=regexp_replace(p_data->>'phone','\D','','g')))) then issues:=issues||'[{"code":"IMPORT_EXISTING","field":"phone"}]'; end if;
   if exists(select 1 from public.customers c where c.organization_id=p_organization_id and lower(c.full_name)=lower(p_data->>'name')) then issues:=issues||'[{"code":"IMPORT_NAME_WARNING","field":"name","severity":"warning"}]'; end if;
 elsif p_type='OPENING_STOCK' then
   if not exists(select 1 from public.branches where id=p_branch_id and organization_id=p_organization_id and status='active') or not app_private.has_branch_access(p_branch_id) or (coalesce(p_data->>'branch_id','')<>'' and p_data->>'branch_id'<>p_branch_id::text) then issues:=issues||'[{"code":"IMPORT_BRANCH","field":"branch_id"}]'; end if;
   select count(*) into matches from public.products p where p.organization_id=p_organization_id and p.status='active' and (p.id::text=nullif(p_data->>'product_id','') or p.sku=nullif(p_data->>'sku','') or exists(select 1 from public.product_barcodes bc where bc.organization_id=p_organization_id and bc.product_id=p.id and bc.barcode=nullif(p_data->>'barcode','')));
   if matches<>1 then issues:=issues||'[{"code":"IMPORT_PRODUCT_MATCH","field":"sku"}]';
   else
     select * into prod from public.products p where p.organization_id=p_organization_id and p.status='active' and (p.id::text=nullif(p_data->>'product_id','') or p.sku=nullif(p_data->>'sku','') or exists(select 1 from public.product_barcodes bc where bc.organization_id=p_organization_id and bc.product_id=p.id and bc.barcode=nullif(p_data->>'barcode','')));
     if (coalesce(p_data->>'sku','')<>'' and prod.sku is distinct from p_data->>'sku') or (coalesce(p_data->>'product_id','')<>'' and prod.id::text<>p_data->>'product_id') or (coalesce(p_data->>'barcode','')<>'' and not exists(select 1 from public.product_barcodes where organization_id=p_organization_id and product_id=prod.id and barcode=p_data->>'barcode')) then issues:=issues||'[{"code":"IMPORT_PRODUCT_MATCH","field":"sku"}]'; end if;
     if coalesce(p_data->>'stock_unit','')<>'' and prod.stock_unit<>p_data->>'stock_unit' then issues:=issues||'[{"code":"IMPORT_STOCK_UNIT_MATCH","field":"stock_unit"}]'; end if;
   end if;
   if coalesce(trim(p_data->>'lot_number'),'')='' then issues:=issues||'[{"code":"IMPORT_LOT_REQUIRED","field":"lot_number"}]'; end if;
   for f in select unnest(array['quantity','purchase_cost','selling_price']) loop
     val:=p_data->>f;
     if f='purchase_cost' and coalesce(val,'')='' then continue; end if;
     if coalesce(val,'') !~ '^[+]?[0-9]+(\.[0-9]+)?$' then issues:=issues||jsonb_build_array(jsonb_build_object('code','IMPORT_'||upper(f),'field',f));
     elsif val::numeric<0 or (f<>'purchase_cost' and val::numeric=0) or val::numeric>=1000000000000 then issues:=issues||jsonb_build_array(jsonb_build_object('code','IMPORT_'||upper(f),'field',f));
     elsif scale(val::numeric)>(case when f='quantity' then 4 else 2 end) then issues:=issues||jsonb_build_array(jsonb_build_object('code',case when f='quantity' then 'IMPORT_QUANTITY_PRECISION' else 'IMPORT_MONEY_PRECISION' end,'field',f)); end if;
   end loop;
   begin
     val:=p_data->>'expiry_date';
     if coalesce(val,'') !~ '^\d{4}-\d{2}-\d{2}$' or not isfinite(val::date) or to_char(val::date,'YYYY-MM-DD')<>val then raise exception 'date'; end if;
   exception when others then issues:=issues||'[{"code":"IMPORT_EXPIRY","field":"expiry_date"}]'; end;
   if jsonb_array_length(issues)=0 then
     select * into b from public.batches where organization_id=p_organization_id and branch_id=p_branch_id and product_id=prod.id and lot_number=p_data->>'lot_number';
     if found and (b.expiry_date is distinct from (p_data->>'expiry_date')::date or b.purchase_cost is distinct from nullif(p_data->>'purchase_cost','')::numeric or b.selling_price is distinct from (p_data->>'selling_price')::numeric or b.status not in ('ACTIVE','EXPIRED')) then issues:=issues||'[{"code":"IMPORT_BATCH_MATCH","field":"lot_number"}]'; end if;
   end if;
 end if;
 return issues;
end $$;
revoke all on function public.check_import_row(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.check_import_row(uuid,uuid,text,jsonb) to authenticated;

create function public.preview_import_rows(p_organization_id uuid,p_branch_id uuid,p_type text,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare result jsonb:='[]'; r jsonb;
begin
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 or octet_length(p_rows::text)>2000000 then raise exception 'IMPORT_LIMIT'; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
   result:=result||jsonb_build_array(jsonb_build_object('rowNumber',(r->>'row_number')::integer,'issues',public.check_import_row(p_organization_id,p_branch_id,p_type,r->'normalized_data')));
 end loop;
 return result;
end $$;
revoke all on function public.preview_import_rows(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.preview_import_rows(uuid,uuid,text,jsonb) to authenticated;

-- Atomic staging under an existing job UUID. An exact retry recovers accepted state.
create function public.stage_import_job(p_job_id uuid,p_organization_id uuid,p_branch_id uuid,p_type text,p_file_name text,p_rows jsonb)
returns uuid language plpgsql security invoker set search_path=public,app_private,pg_temp as $$
declare j public.import_jobs%rowtype; r jsonb; issues jsonb; row_errors jsonb;
begin
 if auth.uid() is null or not app_private.is_org_member(p_organization_id) or not app_private.has_permission(p_organization_id,'import.manage') then raise exception 'IMPORT_FORBIDDEN'; end if;
 if p_job_id is null or p_type not in ('PRODUCTS','SUPPLIERS','CUSTOMERS','OPENING_STOCK') or coalesce(length(p_file_name),0)>200 or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 or octet_length(p_rows::text)>2000000 then raise exception 'IMPORT_LIMIT'; end if;
 perform pg_advisory_xact_lock(hashtextextended('import-stage:'||p_job_id::text,0));
 select * into j from public.import_jobs where id=p_job_id for update;
 if found then
   if j.organization_id<>p_organization_id or j.created_by<>auth.uid() or j.branch_id is distinct from p_branch_id or j.import_type<>p_type or j.file_name is distinct from p_file_name or
     (select jsonb_agg(jsonb_build_object('row_number',row_number,'raw_data',raw_data,'normalized_data',normalized_data) order by row_number) from public.import_rows where import_job_id=j.id) is distinct from (select jsonb_agg(value order by (value->>'row_number')::integer) from jsonb_array_elements(p_rows)) then raise exception 'IDEMPOTENCY_PAYLOAD_MISMATCH'; end if;
   return j.id;
 end if;
 if p_type='OPENING_STOCK' and (p_branch_id is null or not app_private.has_branch_access(p_branch_id) or not exists(select 1 from public.branches where id=p_branch_id and organization_id=p_organization_id and status='active')) then raise exception 'IMPORT_BRANCH'; end if;
 insert into public.import_jobs(id,organization_id,branch_id,import_type,file_name,status,total_rows) values(p_job_id,p_organization_id,p_branch_id,p_type,p_file_name,'DRAFT',jsonb_array_length(p_rows));
 for r in select value from jsonb_array_elements(p_rows) loop
   if coalesce((r->>'row_number')::integer,0)<2 or jsonb_typeof(r->'raw_data') is distinct from 'object' or jsonb_typeof(r->'normalized_data') is distinct from 'object' then raise exception 'IMPORT_INPUT_INVALID'; end if;
   issues:=public.check_import_row(p_organization_id,p_branch_id,p_type,r->'normalized_data');
   select coalesce(jsonb_agg(value),'[]') into row_errors from jsonb_array_elements(issues) where value->>'severity' is distinct from 'warning';
   insert into public.import_rows(import_job_id,organization_id,row_number,raw_data,normalized_data,status,errors) values(p_job_id,p_organization_id,(r->>'row_number')::integer,r->'raw_data',r->'normalized_data',case when jsonb_array_length(row_errors)>0 then 'INVALID' else 'VALID' end,row_errors);
 end loop;
 update public.import_jobs set status='READY',valid_rows=(select count(*) from public.import_rows where import_job_id=p_job_id and status='VALID'),invalid_rows=(select count(*) from public.import_rows where import_job_id=p_job_id and status='INVALID') where id=p_job_id;
 return p_job_id;
end $$;
revoke all on function public.stage_import_job(uuid,uuid,uuid,text,text,jsonb) from public,anon;
grant execute on function public.stage_import_job(uuid,uuid,uuid,text,text,jsonb) to authenticated;

create or replace function public.commit_import_job(p_import_job_id uuid)
returns integer language plpgsql security invoker set search_path=public,app_private,pg_temp as $$
declare v_job public.import_jobs%rowtype; v_row record; v_count integer:=0; v_product uuid; v_batch uuid; v_matches integer; v_issues jsonb;
begin
 select * into v_job from public.import_jobs where id=p_import_job_id for update;
 if not found then raise exception using errcode='P0002',message='IMPORT_JOB_NOT_FOUND'; end if;
 if not app_private.has_permission(v_job.organization_id,'import.manage') then raise exception using errcode='42501',message='IMPORT_FORBIDDEN'; end if;
 if v_job.status in ('COMPLETED','FAILED') then return v_job.valid_rows; end if;
 if v_job.status not in ('READY','FAILED') then raise exception using errcode='23514',message='IMPORT_JOB_NOT_READY'; end if;
 perform pg_advisory_xact_lock(hashtextextended('onboarding:'||v_job.organization_id::text,0));
 update public.import_jobs set status='COMMITTING',error_summary='{}'::jsonb where id=v_job.id;
 for v_row in select * from public.import_rows where import_job_id=v_job.id and organization_id=v_job.organization_id and status<>'IMPORTED' order by row_number loop
  begin
   if v_row.status='INVALID' then continue; end if;
   v_issues:=public.check_import_row(v_job.organization_id,v_job.branch_id,v_job.import_type,v_row.normalized_data);
   if exists(select 1 from jsonb_array_elements(v_issues) i where i->>'severity' is distinct from 'warning') then
     update public.import_rows set status='INVALID',errors=v_issues where id=v_row.id; continue;
   end if;
   if v_row.status<>'VALID' then raise exception using errcode='23514',message='IMPORT_ROW_NOT_VALIDATED'; end if;
   if v_job.import_type='PRODUCTS' then
    v_product:=public.create_catalog_product(v_job.organization_id,v_row.normalized_data);
   elsif v_job.import_type='SUPPLIERS' then
    if not app_private.has_permission(v_job.organization_id,'purchase.create') then raise exception 'SUPPLIER_IMPORT_FORBIDDEN'; end if;
    if coalesce(trim(v_row.normalized_data->>'name'),'')='' then raise exception 'IMPORT_NAME_REQUIRED'; end if;
    insert into public.suppliers(organization_id,name,code,phone,email,address)
    values(v_job.organization_id,trim(v_row.normalized_data->>'name'),nullif(trim(v_row.normalized_data->>'code'),''),nullif(trim(v_row.normalized_data->>'phone'),''),nullif(trim(v_row.normalized_data->>'email'),''),nullif(trim(v_row.normalized_data->>'address'),''))
    ;
   elsif v_job.import_type='CUSTOMERS' then
    if not app_private.has_permission(v_job.organization_id,'customer.manage') then raise exception 'CUSTOMER_IMPORT_FORBIDDEN'; end if;
    if coalesce(trim(v_row.normalized_data->>'name'),'')='' then raise exception 'IMPORT_NAME_REQUIRED'; end if;
    insert into public.customers(organization_id,full_name,phone,email,preferred_locale,notes,status)
    values(v_job.organization_id,trim(v_row.normalized_data->>'name'),nullif(trim(v_row.normalized_data->>'phone'),''),nullif(trim(v_row.normalized_data->>'email'),''),case when lower(v_row.normalized_data->>'locale')='en' then 'en' else 'fr' end,nullif(trim(v_row.normalized_data->>'notes'),''),coalesce(nullif(v_row.normalized_data->>'status',''),'active'));
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
    if exists(select 1 from public.import_rows ir join public.inventory_movements im on im.organization_id=v_job.organization_id and im.idempotency_key='opening-import:'||v_job.id::text||':'||ir.id::text join public.batches b on b.id=im.batch_id and b.organization_id=im.organization_id where ir.import_job_id=v_job.id and ir.status='IMPORTED' and b.product_id=v_product and b.lot_number=v_row.normalized_data->>'lot_number') then raise exception 'IMPORT_DUPLICATE_ROW'; end if;
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
 return (select valid_rows from public.import_jobs where id=v_job.id);
end $$;
