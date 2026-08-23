# Sprint 7 — Pharmacy Stock Core v1 Completion

## Scope
Sprint 7 closes the P0 operational core before P1 network features begin.

Implemented foundations:
- Customer profiles, preferred locale and consent fields.
- Optional customer association on POS sales.
- Daily sales and inventory-value reporting views.
- Controlled CSV onboarding/import staging and commit for products, suppliers, customers and opening stock.
- Opening-stock imports feed the immutable inventory ledger rather than writing balances directly.
- In-app notification storage and per-user channel preferences.
- Expiry alerts generate in-app notifications for authorized pharmacy members.
- Organization settings for receipt footer, default payment method, low-stock threshold and channel configuration foundation.
- Immutable audit-log enforcement and audit visibility.
- Subscription plan/subscription foundation, including configurable `CORE_35000` at 35,000 XOF/month, one branch and three users.
- English and French application surfaces for Customers, Reports and Operations & Settings.

## Security boundaries
All new tenant-owned tables use RLS. Customer, import, settings, notification and subscription reads/writes are permission constrained.

Customer-linked checkout keeps Sprint 6's atomic sale semantics:
`public.complete_sale_with_customer` is a SECURITY INVOKER API wrapper. It delegates to `app_private.complete_sale_with_customer_impl`, a SECURITY DEFINER transaction worker in the non-exposed private schema. The worker validates the caller through the existing sale implementation and verifies the customer belongs to the same organization before attaching it.

The private worker is executable by `authenticated` only so the invoker wrapper can call it. Because `app_private` is not an exposed Data API schema, it is not a public REST RPC.

Audit records cannot be updated or deleted. Corrections in operational domains must remain attributable through new events or compensating transactions.

## Import lifecycle
1. Parse/stage rows.
2. Store raw + normalized row data.
3. Mark a job READY only after staging.
4. Commit through `commit_import_job`.
5. Re-check caller permissions at commit time.
6. Validate each row against the destination domain.
7. Mark successful rows IMPORTED and failed rows INVALID with error detail.
8. Mark job COMPLETED or FAILED.

Opening stock is especially sensitive: product lookup, branch access and `inventory.adjust` are verified, a physical batch is created/matched, then an `ADJUSTMENT_IN` ledger movement is posted with an import-specific idempotency key.

## Reporting boundary
Sprint 7 reports are intentionally operational and simple. The current views provide daily gross sales and inventory cost/retail value. They inherit the underlying RLS through security-invoker views. More advanced profitability, supplier performance and forecasting remain later work.

## Notification boundary
Sprint 7 provides in-app notification persistence and preferences. Email, SMS, WhatsApp and push are preference/configuration foundations only until concrete providers are selected and integrated. No code should claim those external channels were delivered merely because a preference is enabled.

## Subscription boundary
The database stores plans/subscriptions independently from any payment gateway. Provider collection, webhook reconciliation, automatic suspension/grace behavior and invoicing require a later billing-provider integration. The 35,000 XOF launch plan is data, not hard-coded domain behavior.

## Validation
The Sprint 7 SQL regression suite runs in a transaction and rolls back. It covers customer creation, settings, product/opening-stock imports, ledger integrity, customer-linked checkout, daily sales report, inventory value report, expiry notification fanout, subscription seed, tenant isolation and audit immutability.

Supabase Security Advisor must report zero security lints before merge. GitHub CI must pass dependency validation, TypeScript, lint, automated tests, Expo Doctor and Web export.

## P0 completion gate
After Sprint 7 merge, Pharmacy Stock Core v1 includes organizations/branches/RBAC, products/batches, immutable inventory, purchasing/receiving, expiry/FEFO, POS/refunds, customers, reports, imports, notifications foundation, settings, audit and subscription foundation.

P1 starts only after the Core v1 completion gate. P1 sequence remains branch transfers, Pharmacy Exchange, Medicine Locator, then reservations/Notify Me.
