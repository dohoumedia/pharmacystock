# Functional Requirements, User Stories & Business Rules

## Authentication / organizations
- AUTH-FR-001: email/password sign-in.
- AUTH-FR-002: secure password reset.
- AUTH-FR-003: optional/MFA-ready authentication.
- AUTH-FR-004: mobile biometrics may unlock an already authenticated app securely.
- AUTH-FR-005: sessions follow configurable security policy.
- AUTH-FR-006: suspended users lose access.
- AUTH-FR-007: important authentication/security actions are audited.
- ORG-FR-001: one tenant represents a pharmacy organization.
- ORG-FR-002: organization supports one or more branches.
- ORG-FR-003: users have organization membership and authorized branch scope.
- ORG-FR-004: branch includes name/address/contact/country/currency/timezone/status.
- ORG-FR-005: reports can be branch or organization scoped according to permission.

## Products / batches / inventory
- INV-FR-001: create product with normalized identity fields.
- INV-FR-002: support one or more barcodes where needed.
- INV-FR-003: search name/generic/brand/barcode/SKU/manufacturer.
- INV-FR-004: referenced products are archived, not hard-deleted.
- BAT-FR-001: received batch captures product, branch, lot, expiry, cost, sell price, quantity, supplier/receipt.
- BAT-FR-002: batches remain independently traceable.
- BAT-FR-003: expired batches unavailable for sale.
- BAT-FR-004: recalled/quarantined batches blocked from sale.
- BAT-FR-005: depleted batches retain history.
- STK-FR-001: every stock mutation has a movement containing product/batch/branch/quantity/type/actor/time/reference/reason as applicable.
- STK-FR-002: no silent stock mutation.
- STK-FR-003: manual adjustments require reason.
- STK-FR-004: high-risk adjustments may require manager approval.
- STK-FR-005: negative stock disabled by default.

## Expiry
- EXP-FR-001: calculate days to expiry and configurable warning thresholds; defaults may include 180/90/60/30/7 days.
- EXP-FR-002: dashboard shows at-risk batches, quantity and financial value at risk.
- EXP-FR-003: alerts support in-app and extensible email/push/SMS/WhatsApp channels.
- EXP-FR-004: duplicate notification suppression/escalation rules.
- FEFO: recommend/select earliest-expiring eligible batch, excluding expired/recalled/quarantined stock.

## Purchasing
- SUP-FR-001: suppliers include identity/contact/payment terms/notes/status.
- PUR-FR-001: authorized users create POs.
- PUR-FR-002: PO contains multiple items.
- PUR-FR-003: partial receiving supported.
- PUR-FR-004: receipt captures physical batch data.
- PUR-FR-005: receiving creates inventory movements.
- PUR-FR-006: preserve purchase-cost history.

## POS
- POS-FR-001: authorized cashier starts sale.
- POS-FR-002: add items by barcode/search.
- POS-FR-003: FEFO eligible batch selection/recommendation.
- POS-FR-004: expired/recalled/quarantined stock cannot be selected or sold.
- POS-FR-005: completed sale creates stock-out movements.
- POS-FR-006: configurable payment types include cash/card/mobile money/bank/other.
- POS-FR-007: receipts support English/French.
- POS-FR-008: refunds/voids permission-controlled.

## Customers
- CUS-FR-001: optional profile with name/phone/email/language/consent/notes.
- CUS-FR-002: purchase history role-restricted.
- CUS-FR-003: duplicate detection uses suitable identifiers such as phone/email.
- CUS-FR-004: reservations/availability requests may attach to customers/contact identities.

## Exchange
- EXC-FR-001: participation opt-in.
- EXC-FR-002: eligible batches may be explicitly published.
- EXC-FR-003: listing records product/batch/expiry/quantity/location scope/status/terms.
- EXC-FR-004: expired/recalled/quarantined inventory cannot be listed.
- EXC-FR-005: requesting pharmacy requests quantity.
- EXC-FR-006: source can accept, partially accept or reject.
- EXC-FR-007: accepted request creates controlled transfer workflow.
- EXC-FR-008: stock movement is ledger-based at source/destination, never magical quantity reassignment.
- EXC-FR-009: destination confirms receipt.
- EXC-FR-010: batch traceability remains intact.

## Locator / reservations
- LOC-FR-001: basic public medicine search requires no account.
- LOC-FR-002: search uses controlled public availability projection only.
- LOC-FR-003: pharmacy controls public fields and exact quantity visibility.
- LOC-FR-004: default availability states include In Stock/Low Stock/Contact Pharmacy/Unavailable.
- LOC-FR-005: no autonomous clinical substitution.
- RSV-FR-001: customer can request reservation where enabled.
- RSV-FR-002: pharmacy approval required.
- RSV-FR-003: reservations expire after configured period.
- RSV-FR-004: reserved quantity distinguished from freely available quantity.
- RSV-FR-005: collection converts through legitimate sale workflow.
- AVL-FR-001: customer may request availability alert when unavailable.
- AVL-FR-002: communication consent recorded.
- AVL-FR-003: qualifying restock can match active requests.
- AVL-FR-004: notification does not promise indefinite availability.

## Reports / import / notifications
Required P0 reporting: daily/period sales, branch/staff sales according to permission, inventory value, low/out-of-stock, expiry/expired stock, movements/adjustments, purchasing/suppliers and margin where data quality permits. Exports obey the same authorization as UI.

Import workflow: upload → map → validate → preview → commit → results/error report. Import never bypasses tenant/security/business rules.

Notifications are event-driven and role/preference-aware. Notification deep links still enforce authorization.

## Default roles
Owner, Manager, Pharmacist, Inventory Officer, Cashier, Read-only/Auditor, DohouLabs Platform Admin. Prefer granular capabilities over hard-coded role checks, e.g. `inventory.adjust`, `inventory.dispose`, `sale.create`, `sale.refund`, `purchase.receive`, `exchange.publish`, `exchange.approve`, `reports.finance.read`, `staff.manage`.

## Core business rules
- BR-001: tenant private data is isolated by database RLS.
- BR-002: expired inventory cannot be sold.
- BR-003: recalled/quarantined inventory cannot be sold.
- BR-004: inventory mutations create ledger movements.
- BR-005: transactional history is not normally hard-deleted.
- BR-006: each batch owns independent expiry/quantity.
- BR-007: receiving inventory requires branch context.
- BR-008: sensitive operations are attributable to an actor.
- BR-009: currency/country settings are configurable.
- BR-010: user-selected language controls UI and eligible communications.
- BR-011: Exchange is opt-in.
- BR-012: public medicine availability is opt-in.
- BR-013: public users cannot read private inventory.
- BR-014: Locator does not provide autonomous clinical recommendations.
- BR-015: Exchange preserves batch traceability.
- BR-016: sale and payment are separate concepts.
- BR-017: payment integrations cannot directly manipulate stock.
- BR-018: sensitive retryable operations use idempotency.

## Representative user stories
- US-INV-001: As an Inventory Officer, I want to receive stock by batch/lot and expiry so the pharmacy knows exactly what may expire.
- US-EXP-001: As a Manager, I want advance expiry warnings so I can act before stock becomes a loss.
- US-POS-001: As a Cashier, I want fast barcode checkout so customers are served quickly.
- US-EXC-001: As a Manager, I want to offer eligible excess/at-risk stock to participating pharmacies so useful stock can be redistributed.
- US-LOC-001: As a customer, I want to search for a medicine so I can find participating pharmacies reporting availability.
- US-RSV-001: As a customer, I want to request a reservation and receive pharmacy confirmation.
- US-AI-001: As a Manager, I want a future estimate of stock unlikely to sell before expiry so I can act early; recommendations never automatically transfer stock.

## Priority freeze
P0 = core operations. P1 = branch transfers, Exchange, Locator, reservations, Notify Me. P2 = forecasting/intelligence. P1/P2 must not quietly expand the P0 launch scope.
