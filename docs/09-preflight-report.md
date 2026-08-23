# Pharmacy Stock — Architecture & Requirement Preflight

Status: **READY FOR SPRINT 0 AFTER SUPABASE PROJECT CREATION/SELECTION**

## Executive assessment
The current product specification is coherent enough to begin implementation in controlled sprints. The core architecture is sound: Expo/React Native/React Native Web + TypeScript on the client side, with Supabase PostgreSQL/Auth/RLS/Storage/Edge Functions as the backend platform. The most important architectural choices — ledger-based inventory, batch-level expiry, database-enforced tenant isolation, bilingual EN/FR support, and delayed P1 network features — should remain unchanged unless a concrete implementation constraint emerges.

No production feature coding should begin before the Pharmacy Stock Supabase project/environment is selected or created and Sprint 0 is explicitly started.

## 1. P0 requirement coverage
### Authentication / tenancy
Covered by Master PRD, PRD-005, AUTH-FR/ORG-FR, W-001/W-002, RLS/auth QA. Required implementation modules: Auth, organization context, branch context, memberships, role/permission service and RLS helpers.

### Product catalogue / batches
Covered by PRD-001/013, INV-FR/BAT-FR, W-004/W-006/W-005 and product/batch QA. Required entities: products, product_barcodes, categories, manufacturers, batches.

### Inventory ledger
Covered by PRD-001, STK-FR, W-007/W-009/M-008 and inventory/concurrency QA. Required entities/services: inventory_movements, inventory_balances, InventoryService and atomic mutation functions.

### Purchasing
Covered by PRD-003, SUP/PUR-FR, W-011..W-015/M-006 and purchasing QA. Required entities: suppliers, purchase_orders/items, purchase_receipts/items.

### Expiry
Covered by PRD-004, EXP-FR, W-010/M-007 and expiry QA. Required modules: expiry calculation, thresholds, alerts, FEFO eligibility and value-at-risk reporting.

### POS / sales
Covered by PRD-002, POS-FR, W-016..W-020/M-005 and POS QA. Required entities: sales, sale_items, payments, refunds. Sale completion must be transaction-safe and idempotent.

### Customers
Covered by PRD-007, CUS-FR, W-021/W-022 and customer QA. Anonymous sales remain supported.

### Reporting / imports / audit / notifications / settings / subscription
Covered sufficiently for Sprint 7/Core v1. Exact payment-provider and messaging-provider implementations remain intentionally deferred behind abstractions.

## 2. Architecture assessment
### Recommended monorepo
Keep the documented layout:
- `apps/pharmacy`
- `packages/ui`
- `packages/domain`
- `packages/database`
- `packages/localization`
- `packages/notifications`
- `packages/integrations`
- `supabase/migrations`
- `supabase/functions`
- `supabase/seed`
- `supabase/tests`

Recommendation: start with one universal Expo application rather than separate Web/iOS/Android apps. Platform-specific presentation files are allowed where UX differs, but domain logic stays shared.

### Domain layer
Critical operations should be expressed as explicit domain/service operations, not table mutations from UI components. Initial operations include `receivePurchase`, `adjustInventory`, `completeSale`, `refundSale`, `reserveStock` and later `dispatchTransfer`/`receiveTransfer`.

## 3. Database recommendations
### Core tenancy
Use `organizations` plus `branches`. Users are represented by Supabase Auth identities with an application `profiles` table and membership tables.

### RBAC
Use capabilities/permissions rather than business logic hard-coded to role names. Default roles map to permissions, but permission checks remain capability-based.

### Inventory
Preserve the documented dual-model:
- `inventory_movements`: append-oriented historical source of truth.
- `inventory_balances`: current-state projection for fast reads.

Do not store product-level `quantity` as the source of truth.

### Batch uniqueness
Do not assume lot number is globally unique. A practical uniqueness boundary is likely organization/branch + product + lot + relevant receipt/source identity. This should be finalized during schema implementation to handle suppliers/manufacturers that reuse or omit lot identifiers.

### Monetary values
Use integer minor units or exact PostgreSQL numeric types; never floating-point arithmetic for money. The exact convention should be documented before sales/purchasing implementation.

### Timestamps and expiry
Use UTC timestamps for events. Expiry is primarily a calendar date, not an arbitrary UTC instant. Store expiry dates as `date` unless a country-specific rule requires finer precision.

## 4. RLS recommendations
Create stable helper functions with security-definer semantics only where necessary and carefully audited. Candidate helpers:
- `is_org_member(uuid)`
- `has_org_permission(uuid, text)`
- `has_branch_access(uuid)`

Avoid recursive RLS-policy queries that become hard to reason about or slow.

Every tenant-private table must have RLS enabled before production use. Add tests proving both positive access and negative cross-tenant access.

`inventory_movements` and `audit_logs` should deny ordinary UPDATE/DELETE.

Public Locator access must use a separate controlled table/view/API rather than relaxed policies on private inventory.

## 5. Concurrency / transaction strategy
This is release-critical.

### Sale
A sale transaction must lock/check eligible inventory, create sale/items/payment state, append movements and update balance projection atomically. Concurrent sale of the final unit must result in one success, one failure.

### Purchase receipt
Receipt + batch creation/matching + movement + balance update + PO status update must be atomic and idempotent.

### Stock adjustment
Adjustment writes a compensating movement and updates projection atomically. Reason and actor are mandatory.

### Future reservation/transfer
Reservation and P1 transfers must reserve/consume quantity atomically. Do not implement P1 until the P0 inventory concurrency model has proven reliable.

## 6. Expiry safety
No contradiction found. The architecture should enforce forbidden-batch sale in the domain/database path. FEFO must never include EXPIRED/RECALLED/QUARANTINED batches.

Recommendation: determine the exact policy for products with no expiry date before Sprint 2/5. Some non-drug pharmacy inventory may legitimately have no expiry; the schema should support nullable expiry only for categories allowed by configuration, not silently for all medicines.

## 7. Localization review
The EN/FR architecture is sufficient. Use language-neutral status/error codes and locale-specific presentation. Add a CI/lint check or test utility for missing keys.

Recommendation: decide whether the pharmacy's default language affects public/receipt defaults when no customer preference exists. Current proposed behavior — user/customer preference first, then organization default — is reasonable.

## 8. Security risks and controls
### Critical controls
- Never expose service-role credentials to client bundles.
- Enable RLS before tenant data is populated.
- Use private storage buckets for sensitive documents and signed/authorized access.
- Add rate limits to public Locator/search/reservation endpoints.
- Audit staff/permission changes, stock adjustments, refunds and sensitive transfer actions.
- Separate Development/Staging/Production secrets and Supabase projects/environments.

### Remaining security decision
Support impersonation by DohouLabs admins only if explicitly implemented with reason capture, visible audit trail and very restrictive permissions. It should not be part of Sprint 0 unless needed for support testing.

## 9. P1 compatibility
The P0 model can support Pharmacy Exchange, Medicine Locator, reservations and branch transfers without fundamental redesign if:
- batch IDs remain stable/traceable;
- inventory movements support typed references;
- balances expose available vs reserved quantities;
- public availability is projected separately;
- country configuration exists before Exchange rollout.

## 10. Clinical safety
No clinical decision-support behavior should enter P0/P1 by accident. Product normalization, availability and stock operations are acceptable; autonomous substitution or dosage/treatment guidance is out of scope.

## 11. Required Sprint 0 tests
- authentication smoke tests;
- EN/FR switching and missing-key checks;
- environment configuration validation;
- database migration-from-empty test;
- seed-data installation;
- RLS test harness with at least two organizations;
- cross-tenant negative-access tests for the initial tenancy tables;
- role/permission helper tests;
- Web build plus iOS/Android build configuration validation.

## 12. Decisions that can wait
These do **not** block Sprint 0:
- exact mobile-money/payment provider;
- exact SMS/WhatsApp provider;
- final receipt printer hardware support;
- country-specific Exchange legal rules;
- P2 forecasting model/provider;
- final App Store/Play Store metadata.

## 13. Decisions that should be resolved before relevant sprints
1. **Initial launch country/countries** before payment, tax, pharmacy regulation and Exchange work.
2. **Supabase Pharmacy Stock project** before Sprint 0 backend setup.
3. **Money representation convention** before purchasing/POS implementation.
4. **No-expiry product category rules** before batch/expiry implementation.
5. **Refund/restock policy** for medicine returns before POS refunds go live.
6. **Exchange regulatory rules** per launch country before Sprint 9.

## 14. Current blocker discovered through connected Supabase
The connected Supabase account currently exposes two projects named `Gap_Finder_db` and `codex_Gap_Finder_db`; neither is Pharmacy Stock. A dedicated Pharmacy Stock project is recommended rather than mixing unrelated application data.

Creating a new Supabase project requires selecting the Supabase organization and confirming its cost before creation. Once created, Sprint 0 can establish Auth configuration, migrations, RLS helpers/test harness, seed data, Storage structure and generated TypeScript types in that project.

## Final recommendation
**APPROVE ARCHITECTURE FOR SPRINT 0**, contingent on selecting/creating the dedicated Pharmacy Stock Supabase project. No other design issue found here should block Sprint 0.
