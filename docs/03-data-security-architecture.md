# Data & Security Architecture

## Core entities
`organizations`, `branches`, `profiles`, `organization_memberships`, `roles`, `permissions`, `role_permissions`, `products`, `product_barcodes`, `categories`, `manufacturers`, `batches`, `inventory_balances`, `inventory_movements`, `suppliers`, `purchase_orders`, `purchase_order_items`, `purchase_receipts`, `purchase_receipt_items`, `customers`, `sales`, `sale_items`, `payments`, `refunds`, `expiry_alerts`, `exchange_listings`, `exchange_requests`, `exchange_transfers`, `exchange_transfer_items`, `public_inventory_availability`, `reservations`, `availability_requests`, `notifications`, `notification_preferences`, `audit_logs`, `subscription_plans`, `subscriptions`, `import_jobs`, `import_rows`, `country_configs`.

Tenant-owned tables carry `organization_id`; branch-specific tables carry `branch_id` where appropriate. Use UUID identifiers and timestamps consistently.

## Relationship overview
Organization → Branches → operational records.

Product → Batches → Inventory Movements.

Supplier → Purchase Order → Items → Receipt → Batch → Inventory Movement.

Sale → Sale Items → Batch → Inventory Movement.

Batch → Exchange Listing → Request → Transfer → Transfer Items → source/destination movements.

Private Inventory → controlled public projection → `public_inventory_availability` → Medicine Locator.

## Inventory ledger
`inventory_movements` is historical source of truth. `inventory_balances` is a performant current-state projection. Never rely on a manually editable product quantity as the authoritative model.

Movement examples: `PURCHASE_RECEIPT`, `SALE`, `CUSTOMER_RETURN`, `SUPPLIER_RETURN`, `BRANCH_TRANSFER_OUT`, `BRANCH_TRANSFER_IN`, `EXCHANGE_TRANSFER_OUT`, `EXCHANGE_TRANSFER_IN`, `DAMAGED`, `EXPIRED`, `DISPOSAL`, `RECALL`, `MANUAL_ADJUSTMENT`, `STOCK_COUNT_CORRECTION`.

Movements are append-oriented and ordinary pharmacy users cannot update/delete them. Corrections use compensating movements.

## Batch statuses
Language-neutral internal statuses: `ACTIVE`, `QUARANTINED`, `RECALLED`, `EXPIRED`, `DEPLETED`, `DISPOSED`.

## Transaction safety
Domain operations such as `receivePurchase`, `completeSale`, `refundSale`, `adjustInventory`, `approveExchangeRequest`, `dispatchTransfer`, `receiveTransfer` and reservation acceptance must execute transaction-safely. Use database constraints/locking/atomic functions as appropriate so concurrent operations cannot consume the same final quantity twice.

## Idempotency
Inventory/financial-changing requests carry an idempotency key or equivalent operation identity. Retrying a sale, receipt, refund, transfer dispatch/receipt or reservation mutation must not duplicate state.

## RLS foundation
Suggested helper semantics:
- `is_org_member(org_id)`
- `has_permission(org_id, permission_code)`
- `has_branch_access(branch_id)`

Exact SQL must be reviewed during Codex preflight.

Representative policy intent:
- `products SELECT`: active organization member.
- `products INSERT`: `inventory.product.create`.
- `batches SELECT`: active member + branch access.
- `batches INSERT`: authorized receiving/domain operation.
- `inventory_movements INSERT`: authorized domain/server function; UPDATE/DELETE denied to ordinary users.
- `sales`: branch-authorized access with capability controls.
- `audit_logs`: restricted read; system insert; ordinary UPDATE/DELETE denied.

RLS is mandatory even when application queries already filter by organization.

## Public availability boundary
The Medicine Locator must never query unrestricted private inventory tables. A controlled `public_inventory_availability` projection exposes only explicitly approved fields for opted-in pharmacies. Exact quantity is hidden by default.

## Service boundaries
Prefer `InventoryService`, `PurchasingService`, `SalesService`, `ExchangeService`, `ReservationService`, `NotificationService`, `ReportingService`. UI components do not own critical transaction logic.

## Domain events
Representative events:
`inventory.product.created`, `inventory.batch.received`, `inventory.batch.expiry_warning`, `inventory.stock.low`, `inventory.stock.adjusted`, `purchase.created`, `purchase.approved`, `purchase.received`, `sale.completed`, `sale.refunded`, `exchange.listing.created`, `exchange.request.created`, `exchange.request.approved`, `exchange.transfer.dispatched`, `exchange.transfer.received`, `reservation.created`, `reservation.approved`, `reservation.ready`, `reservation.expired`, `availability.product_available`, `security.login_failed`, `security.role_changed`.

## Stable error codes
Examples: `AUTH_FORBIDDEN`, `TENANT_ACCESS_DENIED`, `BRANCH_ACCESS_DENIED`, `PRODUCT_NOT_FOUND`, `BATCH_NOT_FOUND`, `BATCH_EXPIRED`, `BATCH_RECALLED`, `INSUFFICIENT_STOCK`, `SALE_ALREADY_COMPLETED`, `PURCHASE_ALREADY_RECEIVED`, `EXCHANGE_NOT_ELIGIBLE`, `EXCHANGE_QUANTITY_UNAVAILABLE`, `RESERVATION_EXPIRED`. Clients localize these codes.

## Security requirements
- HTTPS everywhere.
- Supabase RLS on tenant/private tables.
- Service-role key never in client bundles.
- Least privilege.
- Environment separation.
- Secure mobile token storage.
- Rate limit public abuse-sensitive endpoints.
- Input validation.
- Storage policies for private files.
- Sanitized logs with no passwords/tokens.
- Dependency vulnerability review.
- MFA-ready authentication.
- Audit sensitive operations.

## Regulatory configuration
Exchange eligibility must be configurable by country, including feature enablement, allowed categories, minimum remaining shelf life, required licensing/documentation, tax/transfer rules. Architecture support does not imply a transfer is legally allowed in every country; rollout requires local validation.

## Clinical boundary
No autonomous diagnosis, dosage advice, treatment recommendation or substitution. Availability is not clinical advice.
