# DohouLabs Pharmacy Stock

Production planning repository for **DohouLabs Pharmacy Stock**, a bilingual pharmacy operations SaaS for **Web, iOS and Android**.

## Product mission
Help pharmacies reduce expiry losses, improve stock accuracy, manage purchasing and sales, and later participate in a controlled inter-pharmacy stock exchange and public medicine-availability network.

## Required platforms
- Web browser
- iOS
- Android

## Required languages
- English (`en`)
- French (`fr`)

Both languages are first-class. No feature is complete if only one language is implemented.

## Planned stack
- Expo
- React Native
- React Native Web
- TypeScript
- Supabase PostgreSQL
- Supabase Auth
- Supabase Row Level Security
- Supabase Storage
- Supabase Edge Functions where appropriate
- GitHub + Codex workflow

## Product phases
### P0 — Core Pharmacy Stock
Authentication, organizations, branches, roles/permissions, product catalogue, barcodes, batches, inventory ledger, suppliers, purchasing, receiving, expiry center, alerts, POS, payment recording, receipts, customers, reporting, imports, notifications, audit logs, settings and subscription foundation.

### P1 — Network features
Branch transfers, Pharmacy Exchange Network, public Medicine Locator, reservations, Notify Me and public pharmacy profiles.

### P2 — Intelligence
Expiry prediction, demand forecasting, reorder recommendations, dead-stock prediction, intelligent exchange matching and network-demand analytics.

## Non-negotiable rules
- Strict multi-tenant isolation using database-level RLS.
- Inventory is ledger-based; critical stock history is not silently overwritten.
- Expired, recalled and quarantined batches cannot be sold.
- Batch-level traceability is required.
- Public Medicine Locator must never expose private inventory directly.
- Exchange participation is opt-in.
- No autonomous diagnosis, dosage advice or medicine substitution in the core product.
- All user-facing content must support French and English.

## Documentation
- `AGENTS.md` — Codex/engineering operating rules
- `docs/01-product-prd.md` — master product requirements and module PRDs
- `docs/02-functional-requirements.md` — functional requirements, business rules, roles and user stories
- `docs/03-data-security-architecture.md` — schema direction, ledger model, RLS and security
- `docs/04-ux-localization.md` — Web/mobile screens and bilingual UX
- `docs/05-qa-testing.md` — test catalogue and release gates
- `docs/06-engineering-release.md` — repository architecture, CI/CD, environments, deployment and pilot plan
- `docs/07-codex-handoff.md` — Codex preflight and Sprint 0 instructions
- `docs/08-roadmap-traceability.md` — sprint sequence and requirement traceability

## Commercial launch assumption
Initial Pharmacy Stock launch package discussed: **35,000 FCFA/month** for one pharmacy / three users. Pricing must remain configurable rather than hard-coded into domain logic.
