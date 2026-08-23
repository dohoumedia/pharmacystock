# Sprint 0 — Baseline RLS Test Harness

## Purpose
The first release-critical security invariant is simple: **Pharmacy A must never be able to read Pharmacy B's private data.**

The baseline harness lives at:

`supabase/tests/tenancy_rls.sql`

It creates two isolated test identities, two pharmacy organizations and one branch per organization inside a transaction, simulates the `authenticated` role/JWT subject for each user, verifies tenant/branch isolation, then rolls everything back.

## Covered tests
- RLS-T-001: User A sees exactly its own organization.
- RLS-T-002: User A cannot read Pharmacy B.
- RLS-T-003: User A can read Pharmacy A.
- RLS-T-004: User A cannot read Pharmacy B's branch.
- RLS-T-005: `is_org_member()` is false for a foreign tenant.
- RLS-T-006: `is_org_member()` is true for the user's tenant.
- RLS-T-007: `has_branch_access()` is false for a foreign branch.
- RLS-T-008: `has_branch_access()` is true for the user's branch.
- RLS-T-009: User B cannot read Pharmacy A.
- RLS-T-010: User B can read Pharmacy B.

## Execution rule
Run this only against an isolated/local/test Supabase database after migrations. It deliberately inserts test users into `auth.users` and test tenancy records, although the surrounding transaction rolls back.

Do not run the harness against production customer data.

## Future expansion
Sprint 1 should extend the suite to cover:
- permission-based organization/branch mutations;
- staff/role administration;
- self-role escalation rejection;
- suspended membership denial;
- branch-scoped access;
- audit-log authorization.

Later domain sprints add cross-tenant tests for products, batches, inventory movements, purchasing, sales, customers, Exchange and the public Locator boundary.

## Release gate
Any tenant-isolation failure is a release blocker. A hidden UI control is not sufficient protection; the database must reject the access.
