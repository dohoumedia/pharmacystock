create table public.suppliers (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, code text, phone text, email text, address text,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id,id), unique (organization_id,name)
);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null, supplier_id uuid not null, po_number text not null,
  status text not null default 'draft' check(status in ('draft','ordered','partially_received','received','cancelled')),
  ordered_at timestamptz, expected_at date, notes text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(organization_id,id), unique(organization_id,po_number),
  foreign key(organization_id,branch_id) references public.branches(organization_id,id),
  foreign key(organization_id,supplier_id) references public.suppliers(organization_id,id)
);

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  purchase_order_id uuid not null, product_id uuid not null,
  ordered_quantity numeric(14,3) not null check(ordered_quantity>0),
  received_quantity numeric(14,3) not null default 0 check(received_quantity>=0),
  unit_cost numeric(14,2) check(unit_cost is null or unit_cost>=0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(organization_id,id),
  foreign key(organization_id,purchase_order_id) references public.purchase_orders(organization_id,id) on delete cascade,
  foreign key(organization_id,product_id) references public.products(organization_id,id)
);

create table public.purchase_receipts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null, purchase_order_id uuid not null, receipt_number text not null,
  supplier_invoice_number text, received_at timestamptz not null default now(),
  received_by uuid not null default auth.uid() references auth.users(id), notes text,
  created_at timestamptz not null default now(), unique(organization_id,id), unique(organization_id,receipt_number),
  foreign key(organization_id,branch_id) references public.branches(organization_id,id),
  foreign key(organization_id,purchase_order_id) references public.purchase_orders(organization_id,id)
);

create table public.purchase_receipt_lines (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  receipt_id uuid not null, purchase_order_line_id uuid not null, batch_id uuid not null,
  quantity numeric(14,3) not null check(quantity>0), unit_cost numeric(14,2) check(unit_cost is null or unit_cost>=0),
  inventory_movement_id uuid, created_at timestamptz not null default now(), unique(organization_id,id),
  foreign key(organization_id,receipt_id) references public.purchase_receipts(organization_id,id) on delete cascade,
  foreign key(organization_id,purchase_order_line_id) references public.purchase_order_lines(organization_id,id),
  foreign key(organization_id,batch_id) references public.batches(organization_id,id),
  foreign key(inventory_movement_id) references public.inventory_movements(id)
);

create index suppliers_org_idx on public.suppliers(organization_id);
create index purchase_orders_org_branch_idx on public.purchase_orders(organization_id,branch_id);
create index purchase_orders_supplier_idx on public.purchase_orders(organization_id,supplier_id);
create index purchase_order_lines_po_idx on public.purchase_order_lines(organization_id,purchase_order_id);
create index purchase_receipts_po_idx on public.purchase_receipts(organization_id,purchase_order_id);
create index purchase_receipt_lines_receipt_idx on public.purchase_receipt_lines(organization_id,receipt_id);

alter table public.suppliers enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.purchase_receipts enable row level security;
alter table public.purchase_receipt_lines enable row level security;

create policy suppliers_read on public.suppliers for select using(app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'purchase.read'));
create policy suppliers_manage on public.suppliers for all using(app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'purchase.create')) with check(app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'purchase.create'));
create policy po_read on public.purchase_orders for select using(app_private.has_branch_access(branch_id) and app_private.has_permission(organization_id,'purchase.read'));
create policy po_create on public.purchase_orders for insert with check(app_private.has_branch_access(branch_id) and app_private.has_permission(organization_id,'purchase.create'));
create policy po_update on public.purchase_orders for update using(app_private.has_branch_access(branch_id) and app_private.has_permission(organization_id,'purchase.create')) with check(app_private.has_branch_access(branch_id) and app_private.has_permission(organization_id,'purchase.create'));
create policy pol_read on public.purchase_order_lines for select using(app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'purchase.read'));
create policy pol_manage on public.purchase_order_lines for all using(app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'purchase.create')) with check(app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'purchase.create'));
create policy receipts_read on public.purchase_receipts for select using(app_private.has_branch_access(branch_id) and app_private.has_permission(organization_id,'purchase.read'));
create policy receipt_lines_read on public.purchase_receipt_lines for select using(app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'purchase.read'));

revoke insert,update,delete on public.purchase_receipts, public.purchase_receipt_lines from authenticated;

create or replace function public.receive_purchase_order(
  p_purchase_order_id uuid, p_receipt_number text, p_supplier_invoice_number text default null,
  p_lines jsonb default '[]'::jsonb, p_notes text default null
) returns uuid language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_po public.purchase_orders%rowtype; v_receipt uuid; v_line jsonb; v_pol public.purchase_order_lines%rowtype; v_batch uuid; v_qty numeric; v_cost numeric; v_movement uuid;
begin
  select * into v_po from public.purchase_orders where id=p_purchase_order_id for update;
  if not found then raise exception 'PURCHASE_ORDER_NOT_FOUND'; end if;
  if v_po.status in ('received','cancelled') then raise exception 'PURCHASE_ORDER_NOT_RECEIVABLE'; end if;
  if not app_private.has_branch_access(v_po.branch_id) or not app_private.has_permission(v_po.organization_id,'purchase.receive') then raise exception 'PURCHASE_RECEIVE_FORBIDDEN'; end if;
  insert into public.purchase_receipts(organization_id,branch_id,purchase_order_id,receipt_number,supplier_invoice_number,notes)
  values(v_po.organization_id,v_po.branch_id,v_po.id,trim(p_receipt_number),nullif(trim(p_supplier_invoice_number),''),p_notes) returning id into v_receipt;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_pol from public.purchase_order_lines where id=(v_line->>'purchase_order_line_id')::uuid and purchase_order_id=v_po.id for update;
    if not found then raise exception 'PURCHASE_ORDER_LINE_NOT_FOUND'; end if;
    v_qty=(v_line->>'quantity')::numeric;
    if v_qty<=0 or v_pol.received_quantity+v_qty>v_pol.ordered_quantity then raise exception 'INVALID_RECEIPT_QUANTITY'; end if;
    v_cost=coalesce(nullif(v_line->>'unit_cost','')::numeric,v_pol.unit_cost);
    select id into v_batch from public.batches where organization_id=v_po.organization_id and branch_id=v_po.branch_id and product_id=v_pol.product_id and lot_number=trim(v_line->>'lot_number') and expiry_date=(v_line->>'expiry_date')::date limit 1;
    if v_batch is null then
      insert into public.batches(organization_id,branch_id,product_id,lot_number,expiry_date,purchase_cost)
      values(v_po.organization_id,v_po.branch_id,v_pol.product_id,trim(v_line->>'lot_number'),(v_line->>'expiry_date')::date,v_cost) returning id into v_batch;
    end if;
    v_movement=public.post_inventory_movement(v_po.organization_id,v_po.branch_id,v_batch,'PURCHASE_RECEIPT',v_qty,'purchase receipt','purchase_receipt',v_receipt,v_cost,'purchase-receipt:'||v_receipt::text||':'||v_pol.id::text,now(),jsonb_build_object('purchase_order_id',v_po.id));
    insert into public.purchase_receipt_lines(organization_id,receipt_id,purchase_order_line_id,batch_id,quantity,unit_cost,inventory_movement_id)
    values(v_po.organization_id,v_receipt,v_pol.id,v_batch,v_qty,v_cost,v_movement);
    update public.purchase_order_lines set received_quantity=received_quantity+v_qty,updated_at=now() where id=v_pol.id;
  end loop;
  if not exists(select 1 from public.purchase_order_lines where purchase_order_id=v_po.id and received_quantity<ordered_quantity) then
    update public.purchase_orders set status='received',updated_at=now() where id=v_po.id;
  else
    update public.purchase_orders set status='partially_received',updated_at=now() where id=v_po.id;
  end if;
  return v_receipt;
end $$;
revoke all on function public.receive_purchase_order(uuid,text,text,jsonb,text) from public;
grant execute on function public.receive_purchase_order(uuid,text,text,jsonb,text) to authenticated;
