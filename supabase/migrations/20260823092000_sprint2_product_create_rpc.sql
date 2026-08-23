create or replace function public.create_product_with_barcode(
  p_organization_id uuid,
  p_name text,
  p_generic_name text default null,
  p_brand_name text default null,
  p_strength text default null,
  p_dosage_form text default null,
  p_package_size text default null,
  p_sku text default null,
  p_category_id uuid default null,
  p_manufacturer_id uuid default null,
  p_barcode text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_product_id uuid;
begin
  insert into public.products(
    organization_id, name, generic_name, brand_name, strength, dosage_form,
    package_size, sku, category_id, manufacturer_id
  ) values (
    p_organization_id, trim(p_name), nullif(trim(p_generic_name), ''), nullif(trim(p_brand_name), ''),
    nullif(trim(p_strength), ''), nullif(trim(p_dosage_form), ''), nullif(trim(p_package_size), ''),
    nullif(trim(p_sku), ''), p_category_id, p_manufacturer_id
  ) returning id into new_product_id;

  if nullif(trim(p_barcode), '') is not null then
    insert into public.product_barcodes(organization_id, product_id, barcode, is_primary)
    values (p_organization_id, new_product_id, trim(p_barcode), true);
  end if;

  return new_product_id;
end;
$$;

grant execute on function public.create_product_with_barcode(uuid,text,text,text,text,text,text,text,uuid,uuid,text) to authenticated;
