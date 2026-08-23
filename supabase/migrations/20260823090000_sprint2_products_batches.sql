alter table public.branches add constraint branches_organization_id_id_unique unique (organization_id, id);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, name)
);

create table public.manufacturers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  country_code text,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, name)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category_id uuid,
  manufacturer_id uuid,
  name text not null,
  generic_name text,
  brand_name text,
  strength text,
  dosage_form text,
  package_size text,
  sku text,
  status text not null default 'active' check (status in ('active','archived')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, category_id) references public.categories(organization_id, id) on delete restrict,
  foreign key (organization_id, manufacturer_id) references public.manufacturers(organization_id, id) on delete restrict,
  constraint products_archive_consistency check (
    (status = 'archived' and archived_at is not null) or (status = 'active' and archived_at is null)
  )
);

create unique index products_org_sku_unique on public.products(organization_id, sku)
where sku is not null and status <> 'archived';

create table public.product_barcodes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  product_id uuid not null,
  barcode text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, barcode),
  foreign key (organization_id, product_id) references public.products(organization_id, id) on delete cascade
);

create unique index product_barcodes_one_primary_per_product
on public.product_barcodes(organization_id, product_id) where is_primary;

create table public.batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  product_id uuid not null,
  lot_number text not null,
  expiry_date date not null,
  purchase_cost numeric(14,2),
  selling_price numeric(14,2),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','QUARANTINED','RECALLED','EXPIRED','DEPLETED','DISPOSED')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, branch_id, product_id, lot_number),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete restrict,
  foreign key (organization_id, product_id) references public.products(organization_id, id) on delete restrict,
  constraint batches_cost_nonnegative check (purchase_cost is null or purchase_cost >= 0),
  constraint batches_price_nonnegative check (selling_price is null or selling_price >= 0)
);

create trigger categories_set_updated_at before update on public.categories for each row execute function public.set_updated_at();
create trigger manufacturers_set_updated_at before update on public.manufacturers for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products for each row execute function public.set_updated_at();
create trigger batches_set_updated_at before update on public.batches for each row execute function public.set_updated_at();

create index products_org_name_idx on public.products(organization_id, lower(name));
create index products_org_generic_name_idx on public.products(organization_id, lower(generic_name)) where generic_name is not null;
create index products_org_brand_name_idx on public.products(organization_id, lower(brand_name)) where brand_name is not null;
create index products_category_id_idx on public.products(category_id);
create index products_manufacturer_id_idx on public.products(manufacturer_id);
create index product_barcodes_product_id_idx on public.product_barcodes(product_id);
create index batches_branch_id_idx on public.batches(branch_id);
create index batches_product_id_idx on public.batches(product_id);
create index batches_expiry_date_idx on public.batches(expiry_date);
create index batches_org_branch_expiry_idx on public.batches(organization_id, branch_id, expiry_date);

alter table public.categories enable row level security;
alter table public.manufacturers enable row level security;
alter table public.products enable row level security;
alter table public.product_barcodes enable row level security;
alter table public.batches enable row level security;

create policy categories_select_inventory on public.categories for select to authenticated using (app_private.has_permission(organization_id, 'inventory.read'));
create policy categories_insert_inventory on public.categories for insert to authenticated with check (app_private.has_permission(organization_id, 'inventory.product.create'));
create policy categories_update_inventory on public.categories for update to authenticated using (app_private.has_permission(organization_id, 'inventory.product.update')) with check (app_private.has_permission(organization_id, 'inventory.product.update'));

create policy manufacturers_select_inventory on public.manufacturers for select to authenticated using (app_private.has_permission(organization_id, 'inventory.read'));
create policy manufacturers_insert_inventory on public.manufacturers for insert to authenticated with check (app_private.has_permission(organization_id, 'inventory.product.create'));
create policy manufacturers_update_inventory on public.manufacturers for update to authenticated using (app_private.has_permission(organization_id, 'inventory.product.update')) with check (app_private.has_permission(organization_id, 'inventory.product.update'));

create policy products_select_inventory on public.products for select to authenticated using (app_private.has_permission(organization_id, 'inventory.read'));
create policy products_insert_inventory on public.products for insert to authenticated with check (app_private.has_permission(organization_id, 'inventory.product.create'));
create policy products_update_inventory on public.products for update to authenticated using (app_private.has_permission(organization_id, 'inventory.product.update')) with check (app_private.has_permission(organization_id, 'inventory.product.update'));

create policy product_barcodes_select_inventory on public.product_barcodes for select to authenticated using (app_private.has_permission(organization_id, 'inventory.read'));
create policy product_barcodes_insert_inventory on public.product_barcodes for insert to authenticated with check (app_private.has_permission(organization_id, 'inventory.product.create'));
create policy product_barcodes_update_inventory on public.product_barcodes for update to authenticated using (app_private.has_permission(organization_id, 'inventory.product.update')) with check (app_private.has_permission(organization_id, 'inventory.product.update'));
create policy product_barcodes_delete_inventory on public.product_barcodes for delete to authenticated using (app_private.has_permission(organization_id, 'inventory.product.update'));

create policy batches_select_inventory on public.batches for select to authenticated using (
  app_private.has_permission(organization_id, 'inventory.read') and (app_private.has_permission(organization_id, 'branch.manage') or app_private.has_branch_access(branch_id))
);
create policy batches_insert_inventory on public.batches for insert to authenticated with check (
  app_private.has_permission(organization_id, 'inventory.product.create') and (app_private.has_permission(organization_id, 'branch.manage') or app_private.has_branch_access(branch_id))
);
create policy batches_update_inventory on public.batches for update to authenticated using (
  app_private.has_permission(organization_id, 'inventory.product.update') and (app_private.has_permission(organization_id, 'branch.manage') or app_private.has_branch_access(branch_id))
) with check (
  app_private.has_permission(organization_id, 'inventory.product.update') and (app_private.has_permission(organization_id, 'branch.manage') or app_private.has_branch_access(branch_id))
);

grant select, insert, update on public.categories, public.manufacturers, public.products, public.batches to authenticated;
grant select, insert, update, delete on public.product_barcodes to authenticated;

create or replace function app_private.audit_catalog_change()
returns trigger language plpgsql security definer set search_path = public, app_private as $$
declare org_id uuid; branch_value uuid;
begin
  org_id := coalesce(new.organization_id, old.organization_id);
  branch_value := case when tg_table_name = 'batches' then coalesce(new.branch_id, old.branch_id) else null end;
  insert into public.audit_logs(organization_id, branch_id, actor_user_id, event_type, entity_type, entity_id, before_data, after_data)
  values (org_id, branch_value, auth.uid(), lower(tg_table_name) || '.' || lower(tg_op), tg_table_name, coalesce(new.id, old.id)::text,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end);
  return coalesce(new, old);
end; $$;
revoke all on function app_private.audit_catalog_change() from public, anon, authenticated;

create trigger categories_catalog_audit after insert or update on public.categories for each row execute function app_private.audit_catalog_change();
create trigger manufacturers_catalog_audit after insert or update on public.manufacturers for each row execute function app_private.audit_catalog_change();
create trigger products_catalog_audit after insert or update on public.products for each row execute function app_private.audit_catalog_change();
create trigger batches_catalog_audit after insert or update on public.batches for each row execute function app_private.audit_catalog_change();
