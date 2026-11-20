# Disposable local PostgreSQL functional fixture. No hosted project, credentials,
# published ports or existing database is used. Requires Docker Desktop.
$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$container = 'pharmacystock-staff-access-' + [guid]::NewGuid().ToString('N').Substring(0, 10)
function Invoke-FixtureSql([string]$sql) {
  $sql | docker exec -i $container psql -U postgres -v ON_ERROR_STOP=1 -X
  if ($LASTEXITCODE -ne 0) { throw 'Local functional database test failed.' }
}
try {
  docker run --detach --name $container --network none --tmpfs /var/lib/postgresql/data -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine
  if ($LASTEXITCODE -ne 0) { throw 'Could not start disposable PostgreSQL.' }
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    docker exec $container pg_isready -U postgres 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Milliseconds 300
  }
  Invoke-FixtureSql @'
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb);
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
    '20260823160000_sprint4_permission_helper_fix.sql'
  )
  foreach ($migration in $foundation) { Invoke-FixtureSql (Get-Content -Raw -LiteralPath (Join-Path $repository "supabase/migrations/$migration")) }
  Invoke-FixtureSql @'
create table public.suppliers(id uuid default gen_random_uuid(),organization_id uuid,status text);
create table public.products(id uuid default gen_random_uuid(),organization_id uuid,status text);
create table public.purchase_orders(id uuid default gen_random_uuid(),organization_id uuid,branch_id uuid,status text);
'@
  Invoke-FixtureSql (Get-Content -Raw -LiteralPath (Join-Path $repository 'supabase/migrations/20261118025513_owner_first_use_and_invitations.sql'))
  Invoke-FixtureSql (Get-Content -Raw -LiteralPath (Join-Path $repository 'supabase/tests/owner_first_use_functional.sql'))
  Invoke-FixtureSql (Get-Content -Raw -LiteralPath (Join-Path $repository 'supabase/migrations/20261118160000_staff_access_completion.sql'))
  Invoke-FixtureSql (Get-Content -Raw -LiteralPath (Join-Path $repository 'supabase/tests/staff_access_functional.sql'))
  Write-Output 'PASS: local staff roles, invitations and branch access workflow'
} finally {
  docker rm --force $container | Out-Null
}
