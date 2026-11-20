param([switch]$KeepFixture)
# Disposable catalog/opening-stock functional fixture. No hosted connection,
# credentials, published ports, migration repair or existing data.
$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$retained = $false
$container = 'pharmacystock-reports-' + [guid]::NewGuid().ToString('N').Substring(0, 10)
function Invoke-CatalogSql([string]$sql) {
  $sql | docker exec -i $container psql -q -U postgres -v ON_ERROR_STOP=1 -X
  if ($LASTEXITCODE -ne 0) { throw 'Local reporting functional database test failed.' }
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
create table auth.users(id uuid primary key,instance_id uuid,aud text,role text,email text,encrypted_password text,email_confirmed_at timestamptz,created_at timestamptz,updated_at timestamptz,raw_app_meta_data jsonb,raw_user_meta_data jsonb);
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
  foreach ($migration in @('20260823161000_sprint5_expiry_fefo_foundation.sql','20260823170000_sprint6_pos_sales_foundation.sql','20260823162813_sprint6_pos_security_boundary.sql','20260823163500_sprint6_refunds_and_pricing.sql')) { Invoke-CatalogSql (Get-Content -Raw -LiteralPath (Join-Path $repository "supabase/migrations/$migration")) }
  Invoke-CatalogSql $core.Substring(0, $core.IndexOf('create table public.import_jobs'))
  $customer = Get-Content -Raw -LiteralPath (Join-Path $repository 'supabase/migrations/20260823171000_sprint7_import_notifications_customer_sales.sql')
  $start = $customer.IndexOf('create or replace function app_private.complete_sale_with_customer_impl')
  $end = $customer.IndexOf('drop trigger if exists customers_audit')
  Invoke-CatalogSql $customer.Substring($start,$end-$start)
  Invoke-CatalogSql (Get-Content -Raw -LiteralPath (Join-Path $repository 'supabase/migrations/20260823171100_sprint7_customer_sale_worker_grant.sql'))
  Invoke-CatalogSql $price.Substring($price.IndexOf('create or replace function public.quote_sale'))
  Invoke-CatalogSql (Get-Content -Raw -LiteralPath (Join-Path $repository 'supabase/migrations/20260920035830_add_refund_audit_log.sql'))
  Invoke-CatalogSql (Get-Content -Raw -LiteralPath (Join-Path $repository 'supabase/migrations/20261118163907_pos_sales_refunds_completion.sql'))
  foreach ($migration in @('20260823171000_sprint8_branch_transfers.sql','20260823174000_sprint8_transfer_rls_hardening.sql','20260823175000_sprint8_transfer_workflow_hardening.sql','20260823181000_sprint8_transfer_performance_hardening.sql')) { Invoke-CatalogSql (Get-Content -Raw -LiteralPath (Join-Path $repository "supabase/migrations/$migration")) }
  Invoke-CatalogSql (Get-Content -Raw -LiteralPath (Join-Path $repository 'supabase/migrations/20261118143500_transfer_operational_context.sql'))
  Invoke-CatalogSql (Get-Content -Raw -LiteralPath (Join-Path $repository 'supabase/migrations/20261118175946_operational_reports_exports.sql'))
  $assertions = Get-Content -Raw -LiteralPath (Join-Path $repository 'supabase/tests/operational_reports_functional.sql')
  if ($KeepFixture) { $assertions = $assertions -replace 'rollback;\s*$', 'commit;' }
  Invoke-CatalogSql $assertions
  if ($KeepFixture) { Set-Content -LiteralPath (Join-Path $repository '.expo/reports-db-container.txt') -Value $container; $retained = $true }
  Write-Output 'PASS: local operational report assertions and reconciliation'
} finally {
  if (-not $retained) { docker rm --force $container | Out-Null }
}
