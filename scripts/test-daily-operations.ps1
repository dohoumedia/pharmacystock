# Reuses the existing package fixture; no hosted API, ports or new server infrastructure.
$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$localContainer = $null
try {
  & (Join-Path $PSScriptRoot 'test-notifications-functional.ps1') -KeepFixture
  $localContainer = (Get-Content -Raw -LiteralPath (Join-Path $repository '.expo/notifications-db-container.txt')).Trim()
  if ($localContainer -notmatch '^pharmacystock-notifications-[a-f0-9]{10}$') { throw 'Unexpected disposable fixture identity' }
  $networkMode = docker inspect --format '{{.HostConfig.NetworkMode}}' $localContainer
  if ($LASTEXITCODE -ne 0 -or $networkMode -ne 'none') { throw 'Fixture must have networking disabled' }
  foreach ($migration in @(
    '20261118132215_inventory_count_completion_audit_boundary.sql',
    '20261118160000_staff_access_completion.sql',
    '20261118215803_controlled_imports_onboarding.sql',
    '20260823161500_sprint5_expiry_actions.sql',
    '20260823162500_sprint5_inventory_movement_types.sql',
    '20260920045243_add_batch_recall_action.sql'
  )) {
    Get-Content -Raw -Encoding utf8 -LiteralPath (Join-Path $repository "supabase/migrations/$migration") |
      docker exec -i $localContainer psql -q -X -U postgres -v ON_ERROR_STOP=1
    if ($LASTEXITCODE -ne 0) { throw "Local fixture dependency failed: $migration" }
  }
  Get-Content -Raw -Encoding utf8 -LiteralPath (Join-Path $repository 'supabase/tests/daily_operations_acceptance.sql') |
    docker exec -i $localContainer psql -q -X -U postgres -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw 'Daily cross-workflow acceptance failed' }
  Write-Output 'PASS: cross-workflow daily operations, exact retries, branch/lot identity, unsafe-stock exclusion and financial/stock reconciliation'
} finally {
  if ($localContainer -match '^pharmacystock-notifications-[a-f0-9]{10}$') {
    docker rm --force $localContainer | Out-Null
  }
}