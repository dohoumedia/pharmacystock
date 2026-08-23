drop policy if exists import_jobs_manage on public.import_jobs;
create policy import_jobs_read on public.import_jobs for select to authenticated using(app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'import.manage'));
create policy import_jobs_insert on public.import_jobs for insert to authenticated with check(created_by=auth.uid() and app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'import.manage'));
create policy import_jobs_update on public.import_jobs for update to authenticated using(app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'import.manage')) with check(app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'import.manage'));

create or replace function public.commit_import_job(p_import_job_id uuid)
returns integer language plpgsql security invoker set search_path=public,app_private,pg_temp as $$
declare v_job public.import_jobs%rowtype; v_row record; v_count integer:=0; v_product uuid; v_batch uuid; v_qty numeric; begin
 select * into v_job from public.import_jobs where id=p_import_job_id for update;
 if not found then raise exception using errcode='P0002',message='IMPORT_JOB_NOT_FOUND'; end if;
 if not app_private.has_permission(v_job.organization_id,'import.manage') then raise exception using errcode='42501',message='IMPORT_FORBIDDEN'; end if;
 if v_job.status not in ('READY','FAILED') then raise exception using errcode='23514',message='IMPORT_JOB_NOT_READY'; end if;
 update public.import_jobs set status='COMMITTING',error_summary='{}'::jsonb where id=v_job.id;
 for v_row in select * from public.import_rows where import_job_id=v_job.id and status='VALID' order by row_number loop
  begin
   if v_job.import_type='PRODUCTS' then
    if not app_private.has_permission(v_job.organization_id,'inventory.product.create') then raise exception 'PRODUCT_IMPORT_FORBIDDEN'; end if;
    insert into public.products(organization_id,name,generic_name,brand_name,strength,dosage_form,package_size,sku)
    values(v_job.organization_id,trim(v_row.normalized_data->>'name'),nullif(trim(v_row.normalized_data->>'generic_name'),''),nullif(trim(v_row.normalized_data->>'brand_name'),''),nullif(trim(v_row.normalized_data->>'strength'),''),nullif(trim(v_row.normalized_data->>'dosage_form'),''),nullif(trim(v_row.normalized_data->>'package_size'),''),nullif(trim(v_row.normalized_data->>'sku'),''));
   elsif v_job.import_type='SUPPLIERS' then
    if not app_private.has_permission(v_job.organization_id,'purchase.create') then raise exception 'SUPPLIER_IMPORT_FORBIDDEN'; end if;
    insert into public.suppliers(organization_id,name,code,phone,email,address)
    values(v_job.organization_id,trim(v_row.normalized_data->>'name'),nullif(trim(v_row.normalized_data->>'code'),''),nullif(trim(v_row.normalized_data->>'phone'),''),nullif(trim(v_row.normalized_data->>'email'),''),nullif(trim(v_row.normalized_data->>'address'),''))
    on conflict(organization_id,name) do update set phone=excluded.phone,email=excluded.email,address=excluded.address;
   elsif v_job.import_type='CUSTOMERS' then
    if not app_private.has_permission(v_job.organization_id,'customer.manage') then raise exception 'CUSTOMER_IMPORT_FORBIDDEN'; end if;
    insert into public.customers(organization_id,full_name,phone,email,preferred_locale,notes)
    values(v_job.organization_id,trim(v_row.normalized_data->>'name'),nullif(trim(v_row.normalized_data->>'phone'),''),nullif(trim(v_row.normalized_data->>'email'),''),case when lower(v_row.normalized_data->>'locale')='en' then 'en' else 'fr' end,nullif(trim(v_row.normalized_data->>'notes'),''));
   elsif v_job.import_type='OPENING_STOCK' then
    if v_job.branch_id is null or not app_private.has_branch_access(v_job.branch_id) or not app_private.has_permission(v_job.organization_id,'inventory.adjust') then raise exception 'OPENING_STOCK_IMPORT_FORBIDDEN'; end if;
    select p.id into v_product from public.products p where p.organization_id=v_job.organization_id and (p.id::text=v_row.normalized_data->>'product_id' or (nullif(v_row.normalized_data->>'sku','') is not null and p.sku=v_row.normalized_data->>'sku')) limit 1;
    if v_product is null then raise exception 'OPENING_STOCK_PRODUCT_NOT_FOUND'; end if;
    v_qty=(v_row.normalized_data->>'quantity')::numeric; if v_qty<=0 then raise exception 'OPENING_STOCK_QUANTITY_INVALID'; end if;
    select id into v_batch from public.batches where organization_id=v_job.organization_id and branch_id=v_job.branch_id and product_id=v_product and lot_number=trim(v_row.normalized_data->>'lot_number') and expiry_date=(v_row.normalized_data->>'expiry_date')::date limit 1;
    if v_batch is null then insert into public.batches(organization_id,branch_id,product_id,lot_number,expiry_date,purchase_cost,selling_price) values(v_job.organization_id,v_job.branch_id,v_product,trim(v_row.normalized_data->>'lot_number'),(v_row.normalized_data->>'expiry_date')::date,nullif(v_row.normalized_data->>'purchase_cost','')::numeric,nullif(v_row.normalized_data->>'selling_price','')::numeric) returning id into v_batch; end if;
    perform public.post_inventory_movement(v_job.organization_id,v_job.branch_id,v_batch,'ADJUSTMENT_IN',v_qty,'opening-import:'||v_job.id::text||':'||v_row.id::text,'Opening stock import','import_job',v_job.id::text,null,jsonb_build_object('row_id',v_row.id),now());
   end if;
   update public.import_rows set status='IMPORTED' where id=v_row.id; v_count:=v_count+1;
  exception when others then update public.import_rows set status='INVALID',errors=jsonb_build_array(sqlerrm) where id=v_row.id;
  end;
 end loop;
 update public.import_jobs set status=case when exists(select 1 from public.import_rows where import_job_id=v_job.id and status='INVALID') then 'FAILED' else 'COMPLETED' end,total_rows=(select count(*) from public.import_rows where import_job_id=v_job.id),valid_rows=(select count(*) from public.import_rows where import_job_id=v_job.id and status='IMPORTED'),invalid_rows=(select count(*) from public.import_rows where import_job_id=v_job.id and status='INVALID'),completed_at=now() where id=v_job.id;
 return v_count;
end $$;
revoke all on function public.commit_import_job(uuid) from public,anon; grant execute on function public.commit_import_job(uuid) to authenticated;

create or replace function app_private.notify_expiry_alert() returns trigger language plpgsql security definer set search_path=public,app_private,pg_temp as $$ begin
 insert into public.notifications(organization_id,branch_id,recipient_user_id,type,title_key,body_key,payload)
 select new.organization_id,new.branch_id,m.user_id,'EXPIRY_ALERT','expiry.title',case when new.alert_type='EXPIRED' then 'expiry.expired' else 'expiry.warning' end,jsonb_build_object('alert_id',new.id,'batch_id',new.batch_id,'days',new.threshold_days)
 from public.organization_memberships m join public.roles r on r.id=m.role_id join public.role_permissions rp on rp.role_id=r.id and rp.permission_code='inventory.read'
 where m.organization_id=new.organization_id and m.status='active'; return new; end $$;
drop trigger if exists expiry_alert_notify on public.expiry_alerts; create trigger expiry_alert_notify after insert on public.expiry_alerts for each row execute function app_private.notify_expiry_alert();

create or replace function app_private.complete_sale_with_customer_impl(p_organization_id uuid,p_branch_id uuid,p_sale_number text,p_lines jsonb,p_payments jsonb,p_idempotency_key text,p_notes text,p_customer_id uuid default null)
returns uuid language plpgsql security definer set search_path=public,app_private,pg_temp as $$ declare v_sale uuid; begin
 v_sale:=app_private.complete_sale_impl(p_organization_id,p_branch_id,p_sale_number,p_lines,p_payments,p_idempotency_key,p_notes);
 if p_customer_id is not null then if not exists(select 1 from public.customers c where c.id=p_customer_id and c.organization_id=p_organization_id and c.status='active') then raise exception using errcode='23503',message='CUSTOMER_NOT_FOUND'; end if; update public.sales set customer_id=p_customer_id where id=v_sale and organization_id=p_organization_id; end if; return v_sale; end $$;
revoke all on function app_private.complete_sale_with_customer_impl(uuid,uuid,text,jsonb,jsonb,text,text,uuid) from public,anon,authenticated;
create or replace function public.complete_sale_with_customer(p_organization_id uuid,p_branch_id uuid,p_sale_number text,p_lines jsonb,p_payments jsonb,p_idempotency_key text,p_notes text default null,p_customer_id uuid default null)
returns uuid language sql security invoker set search_path=public,app_private,pg_temp as $$ select app_private.complete_sale_with_customer_impl(p_organization_id,p_branch_id,p_sale_number,p_lines,p_payments,p_idempotency_key,p_notes,p_customer_id); $$;
revoke all on function public.complete_sale_with_customer(uuid,uuid,text,jsonb,jsonb,text,text,uuid) from public,anon; grant execute on function public.complete_sale_with_customer(uuid,uuid,text,jsonb,jsonb,text,text,uuid) to authenticated;

drop trigger if exists customers_audit on public.customers; create trigger customers_audit after insert or update or delete on public.customers for each row execute function app_private.audit_catalog_change();
drop trigger if exists organization_settings_audit on public.organization_settings; create trigger organization_settings_audit after insert or update or delete on public.organization_settings for each row execute function app_private.audit_catalog_change();
drop trigger if exists import_jobs_audit on public.import_jobs; create trigger import_jobs_audit after insert or update or delete on public.import_jobs for each row execute function app_private.audit_catalog_change();
