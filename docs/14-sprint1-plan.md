# Sprint 1 — Organizations, Branches, Staff, Roles & Production RLS

## Goal
Turn the Sprint 0 tenancy foundation into production-grade organization/branch/staff authorization behavior.

## Scope
1. Harden authorization helper functions outside the exposed Data API schema.
2. Seed default roles: Owner, Manager, Pharmacist, Inventory Officer, Cashier, Read-only/Auditor.
3. Map default roles to granular permissions.
4. Add controlled organization/branch/staff management policies and domain functions.
5. Enforce membership and branch scope on all Sprint 1 operations.
6. Add staff suspension/revocation behavior.
7. Add audit events for role/staff/branch security changes.
8. Expand tenant isolation and privilege-escalation tests.
9. Add organization/branch context UI and staff/branch management foundations in English and French.

## Non-goals
No products, batches, inventory, purchasing, POS, Exchange, Locator or forecasting in Sprint 1.

## Release-critical assertions
- Pharmacy A cannot access Pharmacy B.
- A staff user cannot change their own role or membership status.
- A user cannot assign a permission they are not authorized to manage.
- Suspended/revoked members lose organization access.
- Branch-scoped users cannot access unauthorized branches.
- Authorization decisions are enforced in PostgreSQL/RLS, not only in UI.
