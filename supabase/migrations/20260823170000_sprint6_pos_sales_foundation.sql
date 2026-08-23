insert into public.permissions(code,description_en,description_fr) values
('sale.read','View sales and receipts','Consulter les ventes et reçus'),
('sale.create','Create and complete sales','Créer et finaliser des ventes'),
('sale.refund','Refund completed sales','Rembourser des ventes finalisées')
on conflict(code) do update set description_en=excluded.description_en,description_fr=excluded.description_fr;

insert into public.role_permissions(role_id,permission_code)
select r.id,p.code from public.roles r cross join (values ('sale.read'),('sale.create')) p(code)
where r.organization_id is null and r.code in ('OWNER','MANAGER','PHARMACIST','CASHIER')
on conflict do nothing;
insert into public.role_permissions(role_id,permission_code)
select r.id,'sale.refund' from public.roles r
where r.organization_id is null and r.code in ('OWNER','MANAGER','PHARMACIST')
on conflict do nothing;

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  sale_number text not null,
  status text not null default 'COMPLETED' check(status in ('COMPLETED','PARTIALLY_REFUNDED','REFUNDED','VOIDED')),
  subtotal numeric(18,2) not null default 0 check(subtotal>=0),
  discount_total numeric(18,2) not null default 0 check(discount_total>=0),
  total_amount numeric(18,2) not null default 0 check(total_amount>=0),
  currency_code text not null default 'XOF',
  notes text,
  idempotency_key text not null,
  completed_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(organization_id,sale_number), unique(organization_id,idempotency_key), unique(organization_id,id),
  foreign key(organization_id,branch_id) references public.branches(organization_id,id) on delete restrict
);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  sale_id uuid not null, product_id uuid not null, batch_id uuid not null,
  quantity numeric(18,4) not null check(quantity>0), unit_price numeric(18,2) not null check(unit_price>=0),
  line_total numeric(18,2) generated always as (round((quantity*unit_price)::numeric,2)) stored,
  inventory_movement_id uuid not null references public.inventory_movements(id) on delete restrict, created_at timestamptz not null default now(),
  foreign key(organization_id,sale_id) references public.sales(organization_id,id) on delete restrict,
  foreign key(organization_id,product_id) references public.products(organization_id,id) on delete restrict,
  foreign key(organization_id,batch_id) references public.batches(organization_id,id) on delete restrict
);

create table public.payments (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null, sale_id uuid not null,
  method text not null check(method in ('CASH','CARD','MOBILE_MONEY','BANK_TRANSFER','OTHER')),
  amount numeric(18,2) not null check(amount>0), provider text, external_reference text,
  status text not null default 'RECORDED' check(status in ('RECORDED','REVERSED')),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict, created_at timestamptz not null default now(),
  foreign key(organization_id,branch_id) references public.branches(organization_id,id) on delete restrict,
  foreign key(organization_id,sale_id) references public.sales(organization_id,id) on delete restrict
);

create table public.sale_refunds (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null, sale_id uuid not null, refund_number text not null, reason text not null,
  amount numeric(18,2) not null check(amount>=0), idempotency_key text not null,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict, created_at timestamptz not null default now(),
  unique(organization_id,refund_number), unique(organization_id,idempotency_key),
  foreign key(organization_id,branch_id) references public.branches(organization_id,id) on delete restrict,
  foreign key(organization_id,sale_id) references public.sales(organization_id,id) on delete restrict
);

create table public.sale_refund_items (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  refund_id uuid not null references public.sale_refunds(id) on delete restrict, sale_item_id uuid not null references public.sale_items(id) on delete restrict,
  batch_id uuid not null, quantity numeric(18,4) not null check(quantity>0), amount numeric(18,2) not null check(amount>=0),
  inventory_movement_id uuid references public.inventory_movements(id) on delete restrict, created_at timestamptz not null default now(),
  foreign key(organization_id,batch_id) references public.batches(organization_id,id) on delete restrict
);

create index sales_org_branch_date_idx on public.sales(organization_id,branch_id,completed_at desc);
create index sale_items_sale_idx on public.sale_items(organization_id,sale_id);
create index payments_sale_idx on public.payments(organization_id,sale_id);
create index sale_refunds_sale_idx on public.sale_refunds(organization_id,sale_id);

alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.payments enable row level security;
alter table public.sale_refunds enable row level security;
alter table public.sale_refund_items enable row level security;

create policy sales_read on public.sales for select to authenticated using(app_private.has_branch_access(branch_id) and app_private.has_permission(organization_id,'sale.read'));
create policy sale_items_read on public.sale_items for select to authenticated using(app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'sale.read'));
create policy payments_read on public.payments for select to authenticated using(app_private.has_branch_access(branch_id) and app_private.has_permission(organization_id,'sale.read'));
create policy refunds_read on public.sale_refunds for select to authenticated using(app_private.has_branch_access(branch_id) and app_private.has_permission(organization_id,'sale.read'));
create policy refund_items_read on public.sale_refund_items for select to authenticated using(app_private.is_org_member(organization_id) and app_private.has_permission(organization_id,'sale.read'));

grant select on public.sales,public.sale_items,public.payments,public.sale_refunds,public.sale_refund_items to authenticated;
revoke insert,update,delete on public.sales,public.sale_items,public.payments,public.sale_refunds,public.sale_refund_items from authenticated;

create or replace function public.complete_sale(p_organization_id uuid,p_branch_id uuid,p_sale_number text,p_lines jsonb,p_payments jsonb,p_idempotency_key text,p_notes text default null)
returns uuid language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_sale_id uuid; v_line jsonb; v_payment jsonb; v_product_id uuid; v_requested numeric(18,4); v_remaining numeric(18,4); v_take numeric(18,4); v_price numeric(18,2); v_batch record; v_move uuid; v_subtotal numeric(18,2):=0; v_payment_total numeric(18,2):=0;
begin
  if not app_private.is_org_member(p_organization_id) or not app_private.has_permission(p_organization_id,'sale.create') then raise exception using errcode='42501',message='SALE_CREATE_FORBIDDEN'; end if;
  if not app_private.has_branch_access(p_branch_id) then raise exception using errcode='42501',message='BRANCH_ACCESS_DENIED'; end if;
  if nullif(trim(p_sale_number),'') is null or nullif(trim(p_idempotency_key),'') is null then raise exception using errcode='23514',message='SALE_IDENTITY_REQUIRED'; end if;
  select id into v_sale_id from public.sales where organization_id=p_organization_id and idempotency_key=p_idempotency_key; if v_sale_id is not null then return v_sale_id; end if;
  insert into public.sales(organization_id,branch_id,sale_number,idempotency_key,notes,created_by) values(p_organization_id,p_branch_id,trim(p_sale_number),p_idempotency_key,p_notes,auth.uid()) returning id into v_sale_id;
  if jsonb_array_length(coalesce(p_lines,'[]'::jsonb))=0 then raise exception using errcode='23514',message='SALE_LINES_REQUIRED'; end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_product_id=(v_line->>'product_id')::uuid; v_requested=(v_line->>'quantity')::numeric; v_price=(v_line->>'unit_price')::numeric;
    if v_requested<=0 or v_price<0 then raise exception using errcode='23514',message='INVALID_SALE_LINE'; end if; v_remaining:=v_requested;
    for v_batch in select * from public.get_fefo_batches(p_organization_id,p_branch_id,v_product_id) loop exit when v_remaining<=0; v_take:=least(v_remaining,v_batch.available_quantity);
      v_move:=public.post_inventory_movement(p_organization_id,p_branch_id,v_batch.batch_id,'SALE',-v_take,'sale:'||v_sale_id::text||':'||v_batch.batch_id::text||':'||v_product_id::text,'POS sale','sale',v_sale_id::text,null,jsonb_build_object('product_id',v_product_id),now());
      insert into public.sale_items(organization_id,sale_id,product_id,batch_id,quantity,unit_price,inventory_movement_id) values(p_organization_id,v_sale_id,v_product_id,v_batch.batch_id,v_take,v_price,v_move);
      v_subtotal:=v_subtotal+round((v_take*v_price)::numeric,2); v_remaining:=v_remaining-v_take;
    end loop;
    if v_remaining>0 then raise exception using errcode='23514',message='INSUFFICIENT_STOCK'; end if;
  end loop;
  for v_payment in select * from jsonb_array_elements(coalesce(p_payments,'[]'::jsonb)) loop
    insert into public.payments(organization_id,branch_id,sale_id,method,amount,provider,external_reference,created_by) values(p_organization_id,p_branch_id,v_sale_id,upper(v_payment->>'method'),(v_payment->>'amount')::numeric,nullif(v_payment->>'provider',''),nullif(v_payment->>'external_reference',''),auth.uid());
    v_payment_total:=v_payment_total+(v_payment->>'amount')::numeric;
  end loop;
  if v_payment_total<>v_subtotal then raise exception using errcode='23514',message='PAYMENT_TOTAL_MISMATCH'; end if;
  update public.sales set subtotal=v_subtotal,total_amount=v_subtotal where id=v_sale_id; return v_sale_id;
end $$;

revoke all on function public.complete_sale(uuid,uuid,text,jsonb,jsonb,text,text) from public,anon;
grant execute on function public.complete_sale(uuid,uuid,text,jsonb,jsonb,text,text) to authenticated;
