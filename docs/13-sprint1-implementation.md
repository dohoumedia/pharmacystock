# Sprint 1 — Identity, Organizations, Branches & RBAC

## Implemented
- Authenticated sign-in/sign-out UI for the universal Expo app.
- Organization context and organization switching.
- Branch context and branch-scoped visibility.
- Default system roles: Owner, Manager, Pharmacist, Inventory Officer, Cashier, Auditor.
- Granular permission catalogue and role-permission mappings.
- Staff-management screen for role, status and branch assignment.
- Branch-management screen with permission-aware branch creation.
- English/French UI coverage for Sprint 1 screens.
- RLS write policies for organization, branch and staff administration.
- Self-role/status and self-branch-assignment protections.
- Non-owner promotion to Owner blocked at the database layer.
- Security audit triggers for organization, branch and membership changes.
- Authorization helpers isolated in `app_private` rather than the Data API exposed public schema.
- Staff profile visibility limited to self or authorized staff managers.
- Supporting indexes and RLS init-plan performance hardening.
- Expanded SQL regression coverage for tenant isolation, permissions, suspension and branch scope.

## Security state
Supabase Security Advisor reports zero current security lints after Sprint 1 migrations.

## Performance state
Foreign-key and RLS initialization-plan recommendations were addressed. Newly added supporting indexes may initially appear as unused until real application traffic exercises them; this is expected during pre-launch development.

## Acceptance boundaries
Sprint 1 does not introduce products, batches, inventory ledger, purchasing, POS, Exchange, Locator, reservations or forecasting. Those remain later sprints.

## Sprint 1 exit gate
- GitHub CI green: dependency validation, TypeScript, lint, tests, Expo Doctor and Web export.
- Supabase security advisor green.
- Sprint 1 migrations present in Git and applied to the Pharmacy Stock Supabase project.
- PR reviewed/merged before Sprint 2 starts.
