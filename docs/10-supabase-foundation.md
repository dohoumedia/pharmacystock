# Supabase Foundation — Live Project

## Project
- Name: Pharmacy Stock
- Project ref: `jeravdvssuzbthkxfvjy`
- Region: `eu-west-3` (Paris)
- Status at setup: ACTIVE_HEALTHY

## Security settings chosen at project creation
- Data API: enabled
- Automatically expose new tables: disabled
- Automatic RLS: enabled

## Live migrations applied
1. `sprint0_tenancy_foundation`
2. `sprint0_permissions_seed`
3. `sprint0_security_hardening`

The equivalent migration SQL is persisted under `supabase/migrations/` in this repository so Git remains the reproducible schema source of truth.

## Foundation tables
- `organizations`
- `branches`
- `profiles`
- `roles`
- `permissions`
- `role_permissions`
- `organization_memberships`
- `branch_memberships`
- `audit_logs`

## Foundation helpers
- `is_org_member(uuid)`
- `has_branch_access(uuid)`
- `has_permission(uuid, text)`
- automatic profile creation trigger for new Auth users

## Security posture
RLS is enabled on all foundation tables. Authenticated users only receive explicitly granted table access, with row access constrained by RLS. Audit-log mutation is denied to ordinary authenticated clients. `SECURITY DEFINER` helper execution was hardened after running the Supabase security advisor.

The advisor still warns that the three authenticated RLS helper functions are callable by authenticated users because they are intentionally granted for policy use. Their functions return authorization booleans only; no data mutation is exposed. They must remain covered by RLS/authorization tests and be reconsidered if architecture changes.

## Client configuration
Do not commit the database password or service-role key. Client applications use the project URL plus a Supabase publishable key via environment variables. `.env.example` contains placeholders only.

## Next Sprint 0 tasks
- Universal Expo/React Native/React Native Web scaffold
- strict TypeScript configuration
- Supabase typed client package
- English/French localization package
- auth + organization/branch context UI foundation
- seed/test fixtures for two organizations
- baseline RLS isolation tests
- CI/typecheck/lint/test workflow

Do not add inventory/POS/Exchange domain tables until their designated sprint unless the approved implementation plan explicitly moves a prerequisite forward.
