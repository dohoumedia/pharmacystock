create index if not exists products_org_category_idx on public.products(organization_id, category_id) where category_id is not null;
create index if not exists products_org_manufacturer_idx on public.products(organization_id, manufacturer_id) where manufacturer_id is not null;
create index if not exists batches_org_product_idx on public.batches(organization_id, product_id);
