# Roadmap & Requirement Traceability

## Sprint sequence
### Sprint 0 — Foundation
Monorepo, Expo universal app, TypeScript strictness, Supabase integration, environment separation, auth foundation, organization/branch context, EN/FR localization, design-system primitives, error/logging/test/CI foundation, seed data and baseline RLS test harness.

### Sprint 1 — Organizations, branches, staff & permissions
Organizations, branches, memberships, default roles, granular permissions and production RLS.

### Sprint 2 — Product catalogue & batches
Products, generic/brand identity, barcodes, categories, manufacturers and physical batch/lot model.

### Sprint 3 — Inventory ledger
Movements, balance projection, adjustments, stock counting, concurrency protection and inventory auditability.

### Sprint 4 — Purchasing
Suppliers, purchase orders, partial receiving and batch creation through receipts.

### Sprint 5 — Expiry
Expiry Center, thresholds, FEFO, alerts, quarantine/disposal/return actions.

### Sprint 6 — POS
Sales, payment records, receipts, refunds and idempotent inventory consumption.

### Sprint 7 — Core completion
Customers, reports, imports/onboarding, notifications, audit logs, settings and subscription foundation. This produces Pharmacy Stock Core v1.

### Sprint 8 — Branch transfers (P1)
Request/approve/dispatch/receive/reconcile between branches of the same organization.

### Sprint 9 — Pharmacy Exchange (P1)
Opt-in listing, request, partial approval, transfer workflow, country eligibility and batch traceability.

### Sprint 10 — Medicine Locator (P1)
Controlled public availability projection, public search, pharmacy results and privacy/rate limits.

### Sprint 11 — Reservations + Notify Me (P1)
Reservation lifecycle, stock reservation/release, customer notification and availability requests.

### Sprint 12 — Intelligence (P2)
Expiry risk prediction, demand forecasting, reorder suggestions, dead-stock prediction, intelligent Exchange matching and network analytics after sufficient real data exists.

## Traceability matrix
| Domain | PRD | FRS | Story | UX | QA | Phase |
|---|---|---|---|---|---|---|
| Authentication | Master/005 | AUTH-FR | US-AUTH | W-001 | AUTH/RLS tests | P0 |
| Products | 001/013 | INV-FR | US-PRO | W-004/006 | PRO tests | P0 |
| Batches | 001 | BAT-FR | US-INV | W-005 | BAT tests | P0 |
| Inventory | 001 | STK-FR | US-INV | W-007/009, M-008 | INV tests | P0 |
| Expiry | 004 | EXP-FR | US-EXP | W-010/M-007 | EXP tests | P0 |
| Purchasing | 003 | PUR-FR | US-PUR | W-013/015, M-006 | PUR tests | P0 |
| POS | 002 | POS-FR | US-POS | W-016/020, M-005 | POS tests | P0 |
| Customers | 007 | CUS-FR | US-CUS | W-021/022 | CUS tests | P0 |
| Import | 019 | Import FRS | US-IMP | W-036 | IMP tests | P0 |
| Audit | 020 | Audit FRS | US-AUD | W-038 | AUD tests | P0 |
| Exchange | 010 | EXC-FR | US-EXC | W-023/027, M-009 | EXC tests | P1 |
| Locator | 011 | LOC-FR | US-LOC | C-001/003 | LOC tests | P1 |
| Reservations | 012 | RSV-FR | US-RSV | W-029/C-004 | RSV tests | P1 |
| Notify Me | 012 | AVL-FR | US-AVL | W-030/C-006 | AVL tests | P1 |
| Intelligence | 004/P2 | AI-FR | US-AI | Future | Future QA | P2 |

During implementation each requirement should move through `NOT_STARTED`, `IN_PROGRESS`, `IMPLEMENTED`, `TESTED`, `ACCEPTED`.

## Final pre-Codex gate
Before feature coding: documentation reviewed; Codex preflight completed; contradictions/security/regulatory blockers resolved; Sprint 0 approved. Do not issue a vague “build the whole app” instruction. Build and review sprint by sprint.
