# Pharmacy Stock — Master PRD

## Vision
DohouLabs Pharmacy Stock is a bilingual (French/English), multi-tenant pharmacy operations platform for Web, iOS and Android. It helps pharmacies control inventory by batch, reduce expiry losses, manage purchasing/sales and eventually create a network effect through controlled pharmacy-to-pharmacy exchange and public medicine availability search.

## Users
Owner, Manager, Pharmacist, Inventory Officer, Cashier, Read-only/Auditor, DohouLabs Platform Admin. Public/customer users arrive later for Medicine Locator/reservations.

## P0 — Core launch
### PRD-001 Inventory
Products, barcodes/SKU, categories/manufacturers, batch-level inventory, immutable stock movements, current balance projection, adjustments, stock counts, damaged/expired/recalled/quarantined states, low-stock and expiry search/filtering.

### PRD-002 POS
Fast barcode/search checkout, FEFO eligible batch selection, cash/card/mobile-money/bank/other configurable payment recording, receipts, returns/refunds with permissions, no sale of expired/recalled/quarantined batches.

### PRD-003 Purchasing & suppliers
Supplier records, purchase orders, partial receiving, batch/lot + expiry capture at receipt, purchase-cost history, automatic inventory movements.

### PRD-004 Expiry management
Configurable warning thresholds (default candidates 180/90/60/30/7 days), expiry dashboard, quantity/cost value at risk, actions such as prioritize sale, supplier return, branch transfer, future Exchange, quarantine/disposal. Expired stock blocked from sale.

### PRD-005 Users, roles & security
Auth, organizations/branches, default roles, granular capabilities, tenant isolation through RLS, audit logs, MFA-ready security.

### PRD-006 Reports & analytics
Sales, margin where reliable, inventory value, stock movement, low/out-of-stock, expiry/expired losses, purchasing/suppliers, staff activity, filters and exports.

### PRD-007 Customers
Optional customer profiles, preferred language, consent/preferences, transaction/reservation history. Anonymous sales remain possible.

### PRD-008 Notifications
Shared event-driven notification engine for in-app/email initially and push/SMS/WhatsApp integrations as configured later. Deduplicate alerts.

### PRD-009 Multi-branch foundation
Organization → branches with independent branch inventory, users and reports. Branch transfers are P1.

### PRD-013 Product master catalogue
Normalized medicine/product identity separate from pharmacy-specific physical batches. Support generic/brand names, strength, dosage form, manufacturer, package information, barcodes and country identifiers where available.

### PRD-014 Returns, damages, recalls & disposal
Every stock removal has a reason and audit trail. Disposal is not deletion. Support customer/supplier returns, damaged, expired, recalled, lost/adjustment and disposal workflows according to permissions.

### PRD-015 Settings
Business/branch identity, country/currency/timezone/tax, language, inventory/expiry thresholds, notifications, receipt, security, future Exchange/Locator settings.

### PRD-016 Connectivity resilience
Cached lookups/essential state and clear offline indicators. Sensitive offline mutations require safe idempotent synchronization and conflict handling.

### PRD-017 Platform administration
DohouLabs console for organizations, subscriptions, account status, feature flags, country configuration and support diagnostics. Support access must be controlled/audited.

### PRD-018 Subscription & billing
Plans, trials, subscriptions, invoices/payment records, renewal/grace/suspension states and provider abstraction. Launch assumption: 35,000 FCFA/month package, configurable rather than hard-coded.

### PRD-019 Import/onboarding
CSV/Excel workflow: upload → map columns → validate → preview → import → error report. Products, opening quantities/batches, suppliers and suitable customer data.

### PRD-020 Audit & data lifecycle
Sensitive operations produce audit events. Transactional history uses archive/void/reversal rather than casual hard deletion. Backups, recovery, retention and exports are explicit operational requirements.

## P1 — Network release
### PRD-010 Pharmacy Exchange Network
Participating pharmacies may explicitly publish eligible stock to other participating pharmacies. Goal includes reducing near-expiry/dead-stock loss and satisfying another pharmacy's demand.

Listing includes product, batch/lot, expiry, offered quantity, permitted location information, terms and status. Source pharmacy can accept, partially accept or reject requests. Workflow: REQUESTED → APPROVED → PREPARING → IN_TRANSIT → RECEIVED → COMPLETED, with cancellation/dispute states as required. Expired/recalled/quarantined or country-ineligible stock cannot be listed. Batch traceability survives the transfer. Participation is opt-in.

### PRD-011 Public Medicine Locator
Public/customer search queries only a controlled public availability projection for pharmacies that opt in. Pharmacies control whether to expose availability, price, exact quantity and reservation. Default should prefer statuses such as In Stock/Low Stock rather than exact private quantity. Locator provides availability, not autonomous medical advice/substitution.

### PRD-012 Reservations & availability requests
Customer requests reservation; pharmacy accepts/rejects; accepted quantity becomes reserved for a configurable period; Ready/Collected/Expired/Cancelled lifecycle. Notify Me captures consent and alerts customers when qualifying inventory returns. Aggregate no-result/search demand can later inform purchasing.

### Multi-branch transfers
Same-organization branch transfer workflow: request → approve → dispatch → receive, with immutable inventory movements and discrepancy reconciliation.

## P2 — Intelligence
Expiry-risk prediction, sales/demand forecasting, reorder suggestions, dead-stock prediction, intelligent Exchange matching and network demand analytics. Recommendations remain informational unless a separately specified workflow authorizes action.

## Critical product principles
1. Batch, not product, owns expiry.
2. Inventory history is ledger-based.
3. No negative stock by default.
4. No sale of expired/recalled/quarantined batches.
5. Tenant isolation is database-enforced.
6. English and French are first-class.
7. Public Locator never exposes unrestricted private inventory.
8. Exchange is opt-in and country-configurable.
9. No autonomous clinical diagnosis/dosage/substitution in core product.
10. Web/iOS/Android share domain rules.
