create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  batch_id uuid not null,
  movement_type text not null check (movement_type in (
    'PURCHASE_RECEIPT','SALE','RETURN_IN','RETURN_OUT','TRANSFER_IN','TRANSFER_OUT',
    'DAMAGE','EXPIRY','ADJUSTMENT_IN','ADJUSTMENT_OUT','COUNT_CORRECTION_IN','COUNT_CORRECTION_OUT'
  )),
  quantity_delta numeric(18,4) not null check (quantity_delta <> 0),
  unit_cost numeric(18,4),
  reference_type text,
  reference_id text,
  idempotency_key text not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  constraint inventory_movements_branch_fk foreign key (organization_id, branch_id)
    references public.branches(organization_id, id) on delete restrict,
  constraint inventory_movements_batch_fk foreign key (organization_id, batch_id)
    references public.batches(organization_id, id) on delete restrict,
  constraint inventory_movement_sign_ck check (
    (movement_type in ('PURCHASE_RECEIPT','RETURN_IN','TRANSFER_IN','ADJUSTMENT_IN','COUNT_CORRECTION_IN') and quantity_delta > 0)
    or
    (movement_type in ('SALE','RETURN_OUT','TRANSFER_OUT','DAMAGE','EXPIRY','ADJUSTMENT_OUT','COUNT_CORRECTION_OUT') and quantity_delta < 0)
  ),
  unique (organization_id, idempotency_key)
);

create index if not exists inventory_movements_org_branch_batch_idx
  on public.inventory_movements(organization_id, branch_id, batch_id, occurred_at, id);
create index if not exists inventory_movements_batch_idx on public.inventory_movements(batch_id);
create index if not exists inventory_movements_created_by_idx on public.inventory_movements(created_by);

insert into public.permissions(code, description_en, description_fr)
values
  ('inventory.adjust','Create inventory adjustments and inventory movements','Créer des ajustements et mouvements de stock'),
  ('inventory.count','Perform and reconcile physical stock counts','Effectuer et rapprocher les inventaires physiques')
on conflict (code) do update set
  description_en=excluded.description_en,
  description_fr=excluded.description_fr;

insert into public.role_permissions(role_id, permission_code)
select r.id, p.code
from public.roles r
cross join (values ('inventory.adjust'),('inventory.count')) p(code)
where r.organization_id is null and r.code in ('OWNER','MANAGER','INVENTORY_OFFICER')
on conflict do nothing;

create table if not exists public.inventory_stock_counts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  status text not null default 'OPEN' check (status in ('OPEN','COMPLETED','CANCELLED')),
  notes text,
  counted_at timestamptz,
  created_by uuid not null default auth.uid(),
  completed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_stock_counts_branch_fk foreign key (organization_id, branch_id)
    references public.branches(organization_id, id) on delete restrict
);

create table if not exists public.inventory_stock_count_lines (
  id uuid primary key default gen_random_uuid(),
  stock_count_id uuid not null references public.inventory_stock_counts(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  batch_id uuid not null,
  expected_quantity numeric(18,4) not null default 0,
  counted_quantity numeric(18,4) not null check (counted_quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(stock_count_id,batch_id),
  constraint inventory_count_line_branch_fk foreign key (organization_id, branch_id)
    references public.branches(organization_id, id) on delete restrict,
  constraint inventory_count_line_batch_fk foreign key (organization_id, batch_id)
    references public.batches(organization_id, id) on delete restrict
);

create index if not exists inventory_stock_counts_org_branch_idx on public.inventory_stock_counts(organization_id, branch_id, created_at desc);
create index if not exists inventory_stock_count_lines_count_idx on public.inventory_stock_count_lines(stock_count_id);
create index if not exists inventory_stock_count_lines_batch_idx on public.inventory_stock_count_lines(batch_id);

create or replace function app_private.inventory_lock_key(p_organization_id uuid, p_branch_id uuid, p_batch_id uuid)
returns bigint language sql immutable parallel safe as $$
  select hashtextextended(p_organization_id::text || ':' || p_branch_id::text || ':' || p_batch_id::text, 0);
$$;

create or replace function app_private.assert_inventory_movement_safe()
returns trigger language plpgsql security definer set search_path = public, app_private, pg_temp as $$
declare
  v_current numeric(18,4);
  v_batch_branch uuid;
  v_batch_status text;
begin
  perform pg_advisory_xact_lock(app_private.inventory_lock_key(new.organization_id,new.branch_id,new.batch_id));
  select b.branch_id, b.status into v_batch_branch, v_batch_status
  from public.batches b where b.id=new.batch_id and b.organization_id=new.organization_id;
  if not found then raise exception using errcode='23503', message='INVENTORY_BATCH_NOT_FOUND'; end if;
  if v_batch_branch <> new.branch_id then raise exception using errcode='23514', message='INVENTORY_BATCH_BRANCH_MISMATCH'; end if;
  if v_batch_status in ('RECALLED','DISPOSED') and new.quantity_delta > 0 then
    raise exception using errcode='23514', message='INVENTORY_BATCH_STATUS_BLOCKS_INBOUND';
  end if;
  select coalesce(sum(m.quantity_delta),0)::numeric(18,4) into v_current
  from public.inventory_movements m
  where m.organization_id=new.organization_id and m.branch_id=new.branch_id and m.batch_id=new.batch_id;
  if v_current + new.quantity_delta < 0 then raise exception using errcode='23514', message='INSUFFICIENT_STOCK'; end if;
  return new;
end;
$$;

drop trigger if exists inventory_movements_safety on public.inventory_movements;
create trigger inventory_movements_safety before insert on public.inventory_movements
for each row execute function app_private.assert_inventory_movement_safe();

create or replace function app_private.prevent_inventory_movement_mutation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  raise exception using errcode='55000', message='INVENTORY_LEDGER_IMMUTABLE';
end;
$$;

drop trigger if exists inventory_movements_immutable on public.inventory_movements;
create trigger inventory_movements_immutable before update or delete on public.inventory_movements
for each row execute function app_private.prevent_inventory_movement_mutation();

create or replace view public.inventory_balances with (security_invoker=true) as
select m.organization_id, m.branch_id, m.batch_id, b.product_id,
  sum(m.quantity_delta)::numeric(18,4) as on_hand_quantity,
  0::numeric(18,4) as reserved_quantity,
  sum(m.quantity_delta)::numeric(18,4) as available_quantity,
  max(m.occurred_at) as last_movement_at
from public.inventory_movements m
join public.batches b on b.id=m.batch_id and b.organization_id=m.organization_id
group by m.organization_id,m.branch_id,m.batch_id,b.product_id;

alter table public.inventory_movements enable row level security;
alter table public.inventory_stock_counts enable row level security;
alter table public.inventory_stock_count_lines enable row level security;

create policy inventory_movements_select on public.inventory_movements for select to authenticated using (
  app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'inventory.read') and app_private.has_branch_access(branch_id)
);
create policy inventory_movements_insert on public.inventory_movements for insert to authenticated with check (
  created_by=(select auth.uid()) and app_private.is_org_member(organization_id)
  and app_private.has_permission(organization_id,'inventory.adjust') and app_private.has_branch_access(branch_id)
);
create policy inventory_stock_counts_select on public.inventory_stock_counts for select to authenticated using (
  app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'inventory.read') and app_private.has_branch_access(branch_id)
);
create policy inventory_stock_counts_insert on public.inventory_stock_counts for insert to authenticated with check (
  created_by=(select auth.uid()) and app_private.has_permission(organization_id,'inventory.count') and app_private.has_branch_access(branch_id)
);
create policy inventory_stock_counts_update on public.inventory_stock_counts for update to authenticated
using (status='OPEN' and app_private.has_permission(organization_id,'inventory.count') and app_private.has_branch_access(branch_id))
with check (app_private.has_permission(organization_id,'inventory.count') and app_private.has_branch_access(branch_id));
create policy inventory_stock_count_lines_select on public.inventory_stock_count_lines for select to authenticated using (
  app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'inventory.read') and app_private.has_branch_access(branch_id)
);
create policy inventory_stock_count_lines_insert on public.inventory_stock_count_lines for insert to authenticated with check (
  app_private.has_permission(organization_id,'inventory.count') and app_private.has_branch_access(branch_id)
  and exists (select 1 from public.inventory_stock_counts c where c.id=stock_count_id and c.organization_id=organization_id and c.branch_id=branch_id and c.status='OPEN')
);
create policy inventory_stock_count_lines_update on public.inventory_stock_count_lines for update to authenticated
using (app_private.has_permission(organization_id,'inventory.count') and app_private.has_branch_access(branch_id)
  and exists (select 1 from public.inventory_stock_counts c where c.id=stock_count_id and c.status='OPEN'))
with check (app_private.has_permission(organization_id,'inventory.count') and app_private.has_branch_access(branch_id)
  and exists (select 1 from public.inventory_stock_counts c where c.id=stock_count_id and c.status='OPEN'));

create or replace function public.post_inventory_movement(
  p_organization_id uuid, p_branch_id uuid, p_batch_id uuid, p_movement_type text,
  p_quantity_delta numeric, p_idempotency_key text, p_reason text default null,
  p_reference_type text default null, p_reference_id text default null,
  p_unit_cost numeric default null, p_metadata jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default now()
) returns uuid language plpgsql security invoker set search_path = public, app_private, pg_temp as $$
declare v_id uuid;
begin
  select id into v_id from public.inventory_movements where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if v_id is not null then return v_id; end if;
  insert into public.inventory_movements(
    organization_id,branch_id,batch_id,movement_type,quantity_delta,unit_cost,
    reference_type,reference_id,idempotency_key,reason,metadata,occurred_at,created_by
  ) values (
    p_organization_id,p_branch_id,p_batch_id,p_movement_type,p_quantity_delta,p_unit_cost,
    p_reference_type,p_reference_id,p_idempotency_key,p_reason,coalesce(p_metadata,'{}'::jsonb),p_occurred_at,(select auth.uid())
  ) returning id into v_id;
  return v_id;
exception when unique_violation then
  select id into v_id from public.inventory_movements where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  return v_id;
end;
$$;

create or replace function public.complete_inventory_stock_count(p_stock_count_id uuid)
returns uuid language plpgsql security invoker set search_path = public, app_private, pg_temp as $$
declare
  v_count public.inventory_stock_counts%rowtype;
  v_line record;
  v_current numeric(18,4);
  v_delta numeric(18,4);
begin
  select * into v_count from public.inventory_stock_counts where id=p_stock_count_id for update;
  if not found then raise exception using errcode='P0002', message='STOCK_COUNT_NOT_FOUND'; end if;
  if v_count.status <> 'OPEN' then raise exception using errcode='23514', message='STOCK_COUNT_NOT_OPEN'; end if;
  if not app_private.has_permission(v_count.organization_id,'inventory.count') then raise exception using errcode='42501', message='INSUFFICIENT_PERMISSION'; end if;
  if not app_private.has_branch_access(v_count.branch_id) then raise exception using errcode='42501', message='BRANCH_ACCESS_DENIED'; end if;
  for v_line in select * from public.inventory_stock_count_lines where stock_count_id=p_stock_count_id order by id loop
    perform pg_advisory_xact_lock(app_private.inventory_lock_key(v_line.organization_id,v_line.branch_id,v_line.batch_id));
    select coalesce(sum(quantity_delta),0)::numeric(18,4) into v_current
    from public.inventory_movements where organization_id=v_line.organization_id and branch_id=v_line.branch_id and batch_id=v_line.batch_id;
    v_delta := v_line.counted_quantity - v_current;
    update public.inventory_stock_count_lines set expected_quantity=v_current, updated_at=now() where id=v_line.id;
    if v_delta <> 0 then
      perform public.post_inventory_movement(
        v_line.organization_id,v_line.branch_id,v_line.batch_id,
        case when v_delta > 0 then 'COUNT_CORRECTION_IN' else 'COUNT_CORRECTION_OUT' end,
        v_delta,'stock-count:' || p_stock_count_id::text || ':batch:' || v_line.batch_id::text,
        'Physical stock count reconciliation','STOCK_COUNT',p_stock_count_id::text,null,
        jsonb_build_object('counted_quantity',v_line.counted_quantity,'expected_quantity',v_current),now()
      );
    end if;
  end loop;
  update public.inventory_stock_counts set status='COMPLETED', counted_at=now(), completed_by=(select auth.uid()), updated_at=now() where id=p_stock_count_id;
  return p_stock_count_id;
end;
$$;

grant select on public.inventory_balances to authenticated;
grant execute on function public.post_inventory_movement(uuid,uuid,uuid,text,numeric,text,text,text,text,numeric,jsonb,timestamptz) to authenticated;
grant execute on function public.complete_inventory_stock_count(uuid) to authenticated;
