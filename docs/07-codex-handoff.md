# Codex Handoff

## Preflight prompt
You are the lead implementation agent for DohouLabs Pharmacy Stock in repository `dohoumedia/pharmacystock`.

Your first task is **NOT** to build production features.

Read the complete repository documentation, especially `AGENTS.md` and all files under `docs/`.

The product is a bilingual pharmacy operations SaaS for Web, iOS and Android. Required languages: English and French. Planned stack: Expo, React Native, React Native Web, TypeScript, Supabase PostgreSQL/Auth/RLS/Storage and Edge Functions where appropriate.

Do not implement production features yet. Perform a complete architecture and requirement preflight.

### 1. Requirement coverage
Create a map of all P0 requirements. For each identify source PRD/FRS/story, relevant screens, expected entities/domain service and required tests. Flag contradictions, ambiguity, incompleteness and technical risk.

### 2. Architecture review
Review the proposed monorepo: `apps/pharmacy`, `packages/ui`, `packages/domain`, `packages/database`, `packages/localization`, `packages/notifications`, `packages/integrations`, `supabase/migrations`, `supabase/functions`, `supabase/tests`. Prefer shared domain logic across platforms.

### 3. Supabase review
Review organizations, branches, memberships, roles/permissions, products, batches, ledger/balances, suppliers/purchasing, sales/payments, customers, notifications, audit and subscription foundation. Confirm P0 architecture can later support Exchange and Locator without unsafe redesign.

### 4. RLS review
Tenant isolation is release-critical. Pharmacy A must never access Pharmacy B's private records. Do not rely on frontend filtering. Propose RLS helpers/policy structure and identify append-only/highly restricted tables.

### 5. Inventory integrity
Validate transaction/concurrency strategy for receiving, POS, refunds, adjustments and future branch/Exchange/reservation operations. Negative stock disabled by default. Concurrent operations cannot consume/reserve the same final unit twice.

### 6. Expiry safety
Expired/recalled/quarantined batches cannot be sold. FEFO uses eligible batches only. Rules must be enforced below UI.

### 7. Localization
Every user-facing feature supports `en` and `fr`; no hard-coded strings; internal status codes language-neutral; backend errors stable codes translated by client.

### 8. Security
Review service-role handling, secrets, RLS bypass/role escalation, storage permissions, public APIs/rate limits, deep links, secure mobile storage and environment separation.

### 9. P1 future compatibility
Do not implement yet, but validate support for branch transfers, Pharmacy Exchange, Medicine Locator, reservations and Notify Me. Exchange preserves batch traceability. Locator uses controlled public availability projection.

### 10. Clinical boundary
Do not implement diagnosis, dosage recommendations, treatment recommendations or autonomous medicine substitution.

### 11. Test plan
Map Sprint 0/foundation tests including tenant isolation, permissions, localization, migration and environment/config tests. Later inventory modules require concurrency, idempotency, forbidden-batch and RLS tests.

### 12. Final preflight report
Produce: architecture assessment; requirement gaps; security risks; database/RLS recommendations; final proposed repo structure; Sprint 0 breakdown; Sprint 0 test plan; questions requiring product-owner decisions; risks that should block implementation.

**Stop after the preflight report and wait for approval. Do not start Sprint 0 automatically.**

---

# Sprint 0 Prompt (use only after preflight approval)
Proceed with Sprint 0 only. Do not begin Sprint 1 functionality.

Sprint 0 goal: create the production-grade foundation for DohouLabs Pharmacy Stock.

Implement:
1. Monorepo structure.
2. Expo/React Native/React Native Web app.
3. TypeScript strict configuration.
4. Shared package architecture.
5. Supabase integration foundation.
6. Development/staging/production environment configuration.
7. Authentication foundation.
8. Organization/branch context foundation.
9. English/French localization architecture.
10. Initial design system/shared UI primitives.
11. Error model foundation.
12. Logging/observability foundation.
13. CI checks.
14. Test infrastructure.
15. Development seed data.
16. Baseline RLS test harness.
17. Local setup documentation.

Do **not** yet implement inventory, batches, purchasing, POS, Exchange, Medicine Locator or forecasting.

Before marking Sprint 0 complete: run lint/typecheck/tests; verify Web build and Android/iOS configuration; verify FR/EN switching; verify organization-isolation test setup; update docs.

Open a PR containing summary, requirements addressed, architecture decisions, migrations, tests, Web/iOS/Android status, FR/EN status and known limitations.

**Stop after Sprint 0 and wait for review.**
