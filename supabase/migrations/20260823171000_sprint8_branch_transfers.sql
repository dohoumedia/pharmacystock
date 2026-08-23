insert into public.permissions(code,description_en,description_fr) values
('transfer.read','View inter-branch stock transfers','Consulter les transferts de stock entre succursales'),
('transfer.create','Create inter-branch stock transfers','Créer des transferts de stock entre succursales'),
('transfer.approve','Approve inter-branch stock transfers','Approuver les transferts de stock entre succursales'),
('transfer.dispatch','Dispatch inter-branch stock transfers','Expédier les transferts de stock entre succursales'),
('transfer.receive','Receive inter-branch stock transfers','Réceptionner les transferts de stock entre succursales')
on conflict(code) do update set description_en=excluded.description_en,description_fr=excluded.description_fr;

insert into public.role_permissions(role_id,permission_code)
select r.id,p.code from public.roles r cross join (values
('transfer.read'),('transfer.create'),('transfer.approve'),('transfer.dispatch'),('transfer.receive')) p(code)
where r.organization_id is null and r.code in ('OWNER','MANAGER','INVENTORY_OFFICER')
on conflict do nothing;

insert into public.role_permissions(role_id,permission_code)
select r.id,'transfer.read' from public.roles r where r.organization_id is null and r.code in ('PHARMACIST')
on conflict do nothing;

create table public.stock_transfers(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete restrict,
 source_branch_id uuid not null,
 destination_branch_id uuid not null,
 transfer_number text not null,
 status text not null default 'REQUESTED' check(status in ('REQUESTED','APPROVED','DISPATCHED','RECEIVED','RECEIVED_WITH_DISCREPANCY','CANCELLED')),
 notes text,
 discrepancy_notes text,
 idempotency_key text not null,
 requested_by uuid not null references auth.users(id),
 approved_by uuid references auth.users(id),
 dispatched_by uuid references auth.users(id),
 received_by uuid references auth.users(id),
 requested_at timestamptz not null default now(),
 approved_at timestamptz,
 dispatched_at timestamptz,
 received_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint stock_transfer_distinct_branches check(source_branch_id<>destination_branch_id),
 constraint stock_transfers_source_fk foreign key(organization_id,source_branch_id) references public.branches(organization_id,id),
 constraint stock_transfers_destination_fk foreign key(organization_id,destination_branch_id) references public.branches(organization_id,id),
 unique(organization_id,transfer_number),
 unique(organization_id,idempotency_key),
 unique(organization_id,id)
);

create table public.stock_transfer_lines(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete restrict,
 transfer_id uuid not null,
 source_batch_id uuid not null,
 destination_batch_id uuid,
 product_id uuid not null,
 requested_quantity numeric(18,4) not null check(requested_quantity>0),
 dispatched_quantity numeric(18,4) not null default 0 check(dispatched_quantity>=0),
 received_quantity numeric(18,4) not null default 0 check(received_quantity>=0),
 discrepancy_quantity numeric(18,4) not null default 0 check(discrepancy_quantity>=0),
 discrepancy_reason text,
 transfer_out_movement_id uuid references public.inventory_movements(id),
 transfer_in_movement_id uuid references public.inventory_movements(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(organization_id,transfer_id) references public.stock_transfers(organization_id,id) on delete cascade,
 foreign key(organization_id,source_batch_id) references public.batches(organization_id,id),
 foreign key(organization_id,destination_batch_id) references public.batches(organization_id,id),
 foreign key(organization_id,product_id) references public.products(organization_id,id),
 unique(transfer_id,source_batch_id)
);

create index stock_transfers_org_source_status_idx on public.stock_transfers(organization_id,source_branch_id,status,created_at desc);
create index stock_transfers_org_destination_status_idx on public.stock_transfers(organization_id,destination_branch_id,status,created_at desc);
create index stock_transfer_lines_transfer_idx on public.stock_transfer_lines(transfer_id);
create index stock_transfer_lines_source_batch_idx on public.stock_transfer_lines(source_batch_id);
create index stock_transfer_lines_destination_batch_idx on public.stock_transfer_lines(destination_batch_id);

create trigger stock_transfers_set_updated_at before update on public.stock_transfers for each row execute function public.set_updated_at();
create trigger stock_transfer_lines_set_updated_at before update on public.stock_transfer_lines for each row execute function public.set_updated_at();

alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_lines enable row level security;

create policy stock_transfers_read on public.stock_transfers for select to authenticated using(
 app_private.is_org_member(organization_id)
 and app_private.has_permission(organization_id,'transfer.read')
 and (app_private.has_branch_access(source_branch_id) or app_private.has_branch_access(destination_branch_id) or app_private.has_permission(organization_id,'branch.manage'))
);
create policy stock_transfer_lines_read on public.stock_transfer_lines for select to authenticated using(
 exists(select 1 from public.stock_transfers t where t.id=transfer_id and t.organization_id=organization_id)
);

revoke insert,update,delete on public.stock_transfers,public.stock_transfer_lines from authenticated,anon;
grant select on public.stock_transfers,public.stock_transfer_lines to authenticated;

create or replace function app_private.create_stock_transfer_impl(
 p_organization_id uuid,p_source_branch_id uuid,p_destination_branch_id uuid,p_transfer_number text,
 p_lines jsonb,p_idempotency_key text,p_notes text default null
) returns uuid language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_id uuid; v_line jsonb; v_batch public.batches%rowtype; v_qty numeric;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
 if not app_private.is_org_member(p_organization_id) or not app_private.has_permission(p_organization_id,'transfer.create') then raise exception using errcode='42501',message='TRANSFER_CREATE_FORBIDDEN'; end if;
 if p_source_branch_id=p_destination_branch_id then raise exception using errcode='23514',message='TRANSFER_SAME_BRANCH'; end if;
 if not app_private.has_branch_access(p_source_branch_id) and not app_private.has_permission(p_organization_id,'branch.manage') then raise exception using errcode='42501',message='SOURCE_BRANCH_ACCESS_DENIED'; end if;
 if not exists(select 1 from public.branches where id=p_destination_branch_id and organization_id=p_organization_id and status='active') then raise exception using errcode='23503',message='DESTINATION_BRANCH_INVALID'; end if;
 select id into v_id from public.stock_transfers where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
 if v_id is not null then return v_id; end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception using errcode='23514',message='TRANSFER_LINES_REQUIRED'; end if;
 insert into public.stock_transfers(organization_id,source_branch_id,destination_branch_id,transfer_number,status,notes,idempotency_key,requested_by)
 values(p_organization_id,p_source_branch_id,p_destination_branch_id,trim(p_transfer_number),'REQUESTED',nullif(trim(p_notes),''),p_idempotency_key,auth.uid()) returning id into v_id;
 for v_line in select * from jsonb_array_elements(p_lines) loop
  select * into v_batch from public.batches where id=(v_line->>'source_batch_id')::uuid and organization_id=p_organization_id for share;
  if not found or v_batch.branch_id<>p_source_branch_id then raise exception using errcode='23514',message='TRANSFER_SOURCE_BATCH_INVALID'; end if;
  if v_batch.status<>'ACTIVE' or v_batch.expiry_date<current_date then raise exception using errcode='23514',message='TRANSFER_SOURCE_BATCH_NOT_ELIGIBLE'; end if;
  v_qty=(v_line->>'quantity')::numeric;
  if v_qty is null or v_qty<=0 then raise exception using errcode='23514',message='TRANSFER_QUANTITY_INVALID'; end if;
  insert into public.stock_transfer_lines(organization_id,transfer_id,source_batch_id,product_id,requested_quantity)
  values(p_organization_id,v_id,v_batch.id,v_batch.product_id,v_qty);
 end loop;
 return v_id;
end $$;

create or replace function public.create_stock_transfer(
 p_organization_id uuid,p_source_branch_id uuid,p_destination_branch_id uuid,p_transfer_number text,
 p_lines jsonb,p_idempotency_key text,p_notes text default null
) returns uuid language sql security invoker set search_path=public,app_private as $$
 select app_private.create_stock_transfer_impl(p_organization_id,p_source_branch_id,p_destination_branch_id,p_transfer_number,p_lines,p_idempotency_key,p_notes);
$$;

create or replace function app_private.approve_stock_transfer_impl(p_transfer_id uuid) returns uuid language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_t public.stock_transfers%rowtype;
begin
 select * into v_t from public.stock_transfers where id=p_transfer_id for update;
 if not found then raise exception using errcode='P0002',message='TRANSFER_NOT_FOUND'; end if;
 if v_t.status<>'REQUESTED' then raise exception using errcode='23514',message='TRANSFER_NOT_REQUESTED'; end if;
 if not app_private.has_permission(v_t.organization_id,'transfer.approve') then raise exception using errcode='42501',message='TRANSFER_APPROVE_FORBIDDEN'; end if;
 update public.stock_transfers set status='APPROVED',approved_by=auth.uid(),approved_at=now() where id=p_transfer_id;
 return p_transfer_id;
end $$;
create or replace function public.approve_stock_transfer(p_transfer_id uuid) returns uuid language sql security invoker set search_path=public,app_private as $$ select app_private.approve_stock_transfer_impl(p_transfer_id); $$;

create or replace function app_private.dispatch_stock_transfer_impl(p_transfer_id uuid) returns uuid language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_t public.stock_transfers%rowtype; v_line public.stock_transfer_lines%rowtype; v_batch public.batches%rowtype; v_mov uuid;
begin
 select * into v_t from public.stock_transfers where id=p_transfer_id for update;
 if not found then raise exception using errcode='P0002',message='TRANSFER_NOT_FOUND'; end if;
 if v_t.status='DISPATCHED' then return p_transfer_id; end if;
 if v_t.status<>'APPROVED' then raise exception using errcode='23514',message='TRANSFER_NOT_APPROVED'; end if;
 if not app_private.has_permission(v_t.organization_id,'transfer.dispatch') or (not app_private.has_branch_access(v_t.source_branch_id) and not app_private.has_permission(v_t.organization_id,'branch.manage')) then raise exception using errcode='42501',message='TRANSFER_DISPATCH_FORBIDDEN'; end if;
 for v_line in select * from public.stock_transfer_lines where transfer_id=p_transfer_id order by id for update loop
  select * into v_batch from public.batches where id=v_line.source_batch_id and organization_id=v_t.organization_id;
  if v_batch.status<>'ACTIVE' or v_batch.expiry_date<current_date then raise exception using errcode='23514',message='TRANSFER_SOURCE_BATCH_NOT_ELIGIBLE'; end if;
  v_mov:=public.post_inventory_movement(v_t.organization_id,v_t.source_branch_id,v_line.source_batch_id,'TRANSFER_OUT',-v_line.requested_quantity,
    'transfer:'||p_transfer_id::text||':out:'||v_line.id::text,'Inter-branch transfer dispatch','STOCK_TRANSFER',p_transfer_id::text,v_batch.purchase_cost,
    jsonb_build_object('destination_branch_id',v_t.destination_branch_id),now());
  update public.stock_transfer_lines set dispatched_quantity=requested_quantity,transfer_out_movement_id=v_mov where id=v_line.id;
 end loop;
 update public.stock_transfers set status='DISPATCHED',dispatched_by=auth.uid(),dispatched_at=now() where id=p_transfer_id;
 return p_transfer_id;
end $$;
create or replace function public.dispatch_stock_transfer(p_transfer_id uuid) returns uuid language sql security invoker set search_path=public,app_private as $$ select app_private.dispatch_stock_transfer_impl(p_transfer_id); $$;

create or replace function app_private.receive_stock_transfer_impl(p_transfer_id uuid,p_received_lines jsonb default null,p_discrepancy_notes text default null) returns uuid language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_t public.stock_transfers%rowtype; v_line public.stock_transfer_lines%rowtype; v_source public.batches%rowtype; v_dest uuid; v_received numeric; v_reason text; v_mov uuid; v_has_discrepancy boolean:=false;
begin
 select * into v_t from public.stock_transfers where id=p_transfer_id for update;
 if not found then raise exception using errcode='P0002',message='TRANSFER_NOT_FOUND'; end if;
 if v_t.status in ('RECEIVED','RECEIVED_WITH_DISCREPANCY') then return p_transfer_id; end if;
 if v_t.status<>'DISPATCHED' then raise exception using errcode='23514',message='TRANSFER_NOT_DISPATCHED'; end if;
 if not app_private.has_permission(v_t.organization_id,'transfer.receive') or (not app_private.has_branch_access(v_t.destination_branch_id) and not app_private.has_permission(v_t.organization_id,'branch.manage')) then raise exception using errcode='42501',message='TRANSFER_RECEIVE_FORBIDDEN'; end if;
 for v_line in select * from public.stock_transfer_lines where transfer_id=p_transfer_id order by id for update loop
  select * into v_source from public.batches where id=v_line.source_batch_id and organization_id=v_t.organization_id;
  if p_received_lines is null then v_received:=v_line.dispatched_quantity; v_reason:=null;
  else
   select coalesce((x->>'quantity')::numeric,0),nullif(trim(x->>'reason'),'') into v_received,v_reason
   from jsonb_array_elements(p_received_lines) x where (x->>'line_id')::uuid=v_line.id limit 1;
   v_received:=coalesce(v_received,0);
  end if;
  if v_received<0 or v_received>v_line.dispatched_quantity then raise exception using errcode='23514',message='TRANSFER_RECEIVED_QUANTITY_INVALID'; end if;
  if v_received<>v_line.dispatched_quantity then v_has_discrepancy:=true; end if;
  if v_received>0 then
   select id into v_dest from public.batches where organization_id=v_t.organization_id and branch_id=v_t.destination_branch_id and product_id=v_line.product_id and lot_number=v_source.lot_number and expiry_date=v_source.expiry_date order by created_at limit 1;
   if v_dest is null then
    insert into public.batches(organization_id,branch_id,product_id,lot_number,expiry_date,purchase_cost,selling_price,status,notes)
    values(v_t.organization_id,v_t.destination_branch_id,v_line.product_id,v_source.lot_number,v_source.expiry_date,v_source.purchase_cost,v_source.selling_price,
      case when v_source.expiry_date<current_date then 'EXPIRED' else 'ACTIVE' end,'Created by inter-branch transfer') returning id into v_dest;
   end if;
   v_mov:=public.post_inventory_movement(v_t.organization_id,v_t.destination_branch_id,v_dest,'TRANSFER_IN',v_received,
     'transfer:'||p_transfer_id::text||':in:'||v_line.id::text,'Inter-branch transfer receipt','STOCK_TRANSFER',p_transfer_id::text,v_source.purchase_cost,
     jsonb_build_object('source_branch_id',v_t.source_branch_id,'source_batch_id',v_line.source_batch_id),now());
  else v_dest:=null; v_mov:=null; end if;
  update public.stock_transfer_lines set destination_batch_id=v_dest,received_quantity=v_received,discrepancy_quantity=v_line.dispatched_quantity-v_received,discrepancy_reason=v_reason,transfer_in_movement_id=v_mov where id=v_line.id;
 end loop;
 update public.stock_transfers set status=case when v_has_discrepancy then 'RECEIVED_WITH_DISCREPANCY' else 'RECEIVED' end,
  discrepancy_notes=nullif(trim(p_discrepancy_notes),''),received_by=auth.uid(),received_at=now() where id=p_transfer_id;
 return p_transfer_id;
end $$;
create or replace function public.receive_stock_transfer(p_transfer_id uuid,p_received_lines jsonb default null,p_discrepancy_notes text default null) returns uuid language sql security invoker set search_path=public,app_private as $$ select app_private.receive_stock_transfer_impl(p_transfer_id,p_received_lines,p_discrepancy_notes); $$;

create or replace function app_private.cancel_stock_transfer_impl(p_transfer_id uuid,p_reason text default null) returns uuid language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_t public.stock_transfers%rowtype;
begin
 select * into v_t from public.stock_transfers where id=p_transfer_id for update;
 if not found then raise exception using errcode='P0002',message='TRANSFER_NOT_FOUND'; end if;
 if v_t.status not in ('REQUESTED','APPROVED') then raise exception using errcode='23514',message='TRANSFER_CANNOT_CANCEL'; end if;
 if not app_private.has_permission(v_t.organization_id,'transfer.create') then raise exception using errcode='42501',message='TRANSFER_CANCEL_FORBIDDEN'; end if;
 update public.stock_transfers set status='CANCELLED',notes=concat_ws(E'\n',notes,nullif(trim(p_reason),'')) where id=p_transfer_id;
 return p_transfer_id;
end $$;
create or replace function public.cancel_stock_transfer(p_transfer_id uuid,p_reason text default null) returns uuid language sql security invoker set search_path=public,app_private as $$ select app_private.cancel_stock_transfer_impl(p_transfer_id,p_reason); $$;

revoke all on function app_private.create_stock_transfer_impl(uuid,uuid,uuid,text,jsonb,text,text) from public,anon;
revoke all on function app_private.approve_stock_transfer_impl(uuid) from public,anon;
revoke all on function app_private.dispatch_stock_transfer_impl(uuid) from public,anon;
revoke all on function app_private.receive_stock_transfer_impl(uuid,jsonb,text) from public,anon;
revoke all on function app_private.cancel_stock_transfer_impl(uuid,text) from public,anon;
grant usage on schema app_private to authenticated;
grant execute on function app_private.create_stock_transfer_impl(uuid,uuid,uuid,text,jsonb,text,text),app_private.approve_stock_transfer_impl(uuid),app_private.dispatch_stock_transfer_impl(uuid),app_private.receive_stock_transfer_impl(uuid,jsonb,text),app_private.cancel_stock_transfer_impl(uuid,text) to authenticated;
grant execute on function public.create_stock_transfer(uuid,uuid,uuid,text,jsonb,text,text),public.approve_stock_transfer(uuid),public.dispatch_stock_transfer(uuid),public.receive_stock_transfer(uuid,jsonb,text),public.cancel_stock_transfer(uuid,text) to authenticated;