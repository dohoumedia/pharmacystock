# Disposable inventory/count functional fixture. No hosted connection,
# credentials, published ports, migration repair or existing data.
$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$container = 'pharmacystock-inventory-' + [guid]::NewGuid().ToString('N').Substring(0, 10)
function Invoke-CatalogSql([string]$sql) {
  $sql | docker exec -i $container psql -q -U postgres -v ON_ERROR_STOP=1 -X
  if ($LASTEXITCODE -ne 0) { throw 'Local inventory functional database test failed.' }
}
try {
  docker run --detach --name $container --network none --tmpfs /var/lib/postgresql/data -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine
  if ($LASTEXITCODE -ne 0) { throw 'Could not start disposable PostgreSQL.' }
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    docker exec $container pg_isready -U postgres 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 300
  }
  if (-not $ready) { throw 'Disposable PostgreSQL did not become ready.' }
  Invoke-CatalogSql @'
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
'@
  $foundation = @(
    '20260823033000_sprint0_tenancy_foundation.sql',
    '20260823033100_sprint0_permissions_seed.sql',
    '20260823033200_sprint0_security_hardening.sql',
    '20260823080000_sprint1_rbac_hardening.sql',
    '20260823081000_sprint1_staff_profile_visibility.sql',
    '20260823082000_sprint1_branch_scope_hardening.sql',
    '20260823090000_sprint2_products_batches.sql',
    '20260823092000_sprint2_product_create_rpc.sql',
    '20260823083100_sprint3_inventory_ledger.sql',
    '20260823083900_sprint3_inventory_hardening.sql',
    '20260823155000_sprint4_catalog_audit_trigger_fix.sql',
    '20260823155700_sprint4_inventory_read_grants_fix.sql',
    '20260823160000_sprint4_permission_helper_fix.sql',
    '20260823162000_sprint5_inventory_write_grants_fix.sql'
  )
  foreach ($migration in $foundation) { Invoke-CatalogSql (Get-Content -Raw -LiteralPath (Join-Path $repository "supabase/migrations/$migration")) }
  # Apply unchanged relevant source DDL rather than fabricate a second import model.
  # Other historical domains are intentionally outside this functional fixture.
  $core = Get-Content -Raw -LiteralPath (Join-Path $repository 'supabase/migrations/20260823170000_sprint7_core_completion_foundation.sql')
  $start = $core.IndexOf('create table public.import_jobs')
  $end = $core.IndexOf('create table public.subscription_plans')
  Invoke-CatalogSql $core.Substring($start, $end - $start)
  foreach ($migration in @('20260823110000_sprint4_purchasing_receiving.sql','20260823154306_sprint4_transaction_integrity.sql','20260823155500_sprint4_purchasing_grants.sql')) { Invoke-CatalogSql (Get-Content -Raw -LiteralPath (Join-Path $repository "supabase/migrations/$migration")) }
  $price = Get-Content -Raw -LiteralPath (Join-Path $repository 'supabase/migrations/20260913234137_batch_selling_price_foundation.sql')
  Invoke-CatalogSql $price.Substring(0, $price.IndexOf('create or replace function app_private.receive_purchase_order_impl'))
  Invoke-CatalogSql @'
insert into public.permissions(code,description_en,description_fr) values('import.manage','Import','Importer');
insert into public.role_permissions(role_id,permission_code) select id,'import.manage' from public.roles where code='OWNER' and organization_id is null;
'@
  Invoke-CatalogSql (Get-Content -Raw -LiteralPath (Join-Path $repository 'supabase/migrations/20261118035150_catalog_opening_stock.sql'))
  Invoke-CatalogSql (Get-Content -Raw -LiteralPath (Join-Path $repository 'supabase/migrations/20260920023555_reject_duplicate_purchase_receipt_lines.sql'))
  Invoke-CatalogSql (Get-Content -Raw -LiteralPath (Join-Path $repository 'supabase/migrations/20260920043646_add_stock_count_audit_log.sql'))
  Invoke-CatalogSql (Get-Content -Raw -LiteralPath (Join-Path $repository 'supabase/migrations/20261118132215_inventory_count_completion_audit_boundary.sql'))
  Invoke-CatalogSql (Get-Content -Raw -LiteralPath (Join-Path $repository 'supabase/tests/inventory_completion_functional.sql'))
  # New psql connection proves committed history/line persistence, not only a same-session read.
  Invoke-CatalogSql @'
select public.inventory_test_assert((select status='COMPLETED' from public.inventory_stock_counts where id='cf000000-0000-0000-0000-000000000099'),'completed count survives a new connection');
select public.inventory_test_assert((select count(*)=3 from public.inventory_stock_count_lines where stock_count_id='cf000000-0000-0000-0000-000000000099'),'saved lines survive a new connection');
'@
  Write-Output 'PASS: adjustments, saved counts, variances, one-time reconciliation, movement references and balances'
} finally {
  docker rm --force $container | Out-Null
}
