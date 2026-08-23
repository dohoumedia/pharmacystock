# Engineering, Deployment & Pilot Specification

## Recommended repository architecture
```text
pharmacystock/
├── README.md
├── AGENTS.md
├── apps/
│   └── pharmacy/
├── packages/
│   ├── ui/
│   ├── domain/
│   ├── database/
│   ├── localization/
│   ├── notifications/
│   └── integrations/
├── supabase/
│   ├── migrations/
│   ├── functions/
│   ├── seed/
│   └── tests/
├── docs/
└── .github/workflows/
```

## Frozen implementation direction (subject to Codex preflight)
Expo + React Native + React Native Web + TypeScript; Supabase PostgreSQL/Auth/RLS/Storage/Edge Functions as appropriate. Shared domain logic across Web/iOS/Android.

## Environments
Development, Staging and Production with separate Supabase projects/databases, secrets, provider credentials and storage. Never leak development data/credentials into production. `.env.example` contains names only.

## Git workflow
`main` ← reviewed PRs ← feature/fix branches. Do not dump large unreviewed feature work directly onto main. PRs include summary, requirement IDs, screens, migrations, security/RLS impact, tests, FR/EN status, Web/iOS/Android status and limitations.

## CI gates
Lint, TypeScript typecheck, unit/integration tests, migration checks, RLS/security tests, Web build and mobile configuration/build validation as practical. Critical failures block merge/release.

## Observability
Capture application/API/Edge Function errors, slow queries, failed imports, payment/notification/sync failures and security events. Use correlation IDs where useful. Avoid sensitive payloads in logs.

## Backup/recovery
Automated database backups, storage strategy, restore testing, migration rollback/forward-fix strategy and incident procedure. Early planning target: RPO no worse than ~24h and RTO within several hours, to be tightened as operational dependence grows. Recovery must be tested, not assumed.

## Web release
Production config, HTTPS, monitoring, health/release version identification and reproducible deploys from Git commits.

## iOS release
Apple Developer account, bundle identifier, signing, privacy declarations, bilingual store copy/screenshots, privacy/support information, TestFlight validation and production API configuration. Apple controls final approval.

## Android release
Google Play developer account, application ID/signing, data-safety declarations, bilingual listing/screenshots, internal/closed testing and production configuration. Google controls final approval.

## Analytics
Product events may include product_created, purchase_received, sale_completed, expiry_alert_viewed, expiry_action_taken, exchange_listing_created, exchange_request_sent, exchange_transfer_completed, medicine_search_performed, medicine_search_no_result, reservation_created, reservation_collected.

Owner metrics: sales, inventory value, margin where reliable, stock-outs, expiry-risk value, actual expiry loss, dead stock, supplier performance. DohouLabs metrics: active pharmacies/users, retention, transactions, branches/customer, Exchange adoption/completion, Locator searches, reservation conversion and churn.

## Feature flags
Keep P1/P2 disabled until ready: `exchange.enabled`, `locator.enabled`, `reservations.enabled`, `notify_me.enabled`, `forecasting.enabled`, `multibranch_transfers.enabled`.

## Country configuration
Support country code, currency, timezone, tax rules, payment/messaging providers, Exchange enablement, minimum shelf life and Locator enablement. Do not hard-code one country's regulations into the core domain.

## Pilot/UAT
Start with roughly 3–5 real pharmacies before broad rollout. Phase A tests onboarding/import, receiving, expiry, adjustments, POS, receipts and reports. Phase B adds branch transfer/Exchange/Locator/reservations/Notify Me after core stability.

UAT users should demonstrate: create product, receive batch, search/scan stock, complete sale, receipt, expiry action, stock count/adjustment, supplier/PO/partial receipt, report and FR↔EN switching. Network UAT adds listing/request/approval/dispatch/receipt plus public search/reservation/collection.

Ask pilot customers behavioral/WTP questions rather than only “Do you like it?”: what was slower, where help was needed, what would block tomorrow's use, what they would actually pay for, what they would miss if removed, and whether they would pay the planned fee next month from their business budget.

## Pilot metrics
Core: onboarding without developer intervention, stock accuracy, useful expiry actions, reliable routine sales, bilingual usability, owner reporting usage, critical bug rate and actual willingness-to-pay evidence.

Exchange: listings, requests/listing, approval/completion rate, stock value transferred, estimated expiry loss avoided and repeat usage.

Locator: searches, no-result rate, pharmacy result actions, reservations, acceptance/collection and repeat use.

## Production release checklist
P0 requirements accounted for; P1/P2 disabled/flagged; migrations/RLS/backups verified; Web production build/HTTPS/monitoring; iOS TestFlight/privacy/store materials; Android signed testing/data-safety/store materials; support/incident/admin controls/billing process ready; plan/trial/cancellation/onboarding policy defined.
