# Sprint 6 — POS, Sales, Receipts and Refunds

## Scope
- Permission-aware POS for Web, iOS and Android.
- Product search and cart.
- Server-side FEFO quote.
- Server-authoritative batch selling prices.
- Atomic sale + inventory movement + payment recording.
- Cash, card, mobile money, bank transfer and other payment records.
- Sales history and receipt detail.
- Permission-controlled customer returns/refunds.
- Idempotent sale and refund commands.

## Security boundary
The public `complete_sale` RPC is `SECURITY INVOKER` and delegates to a private `app_private.complete_sale_impl` worker. The private worker is not in the Data API-exposed schema and independently validates the authenticated user, organization membership, branch access and `sale.create` permission.

`refund_sale` follows the same public-invoker/private-worker pattern and requires `sale.refund`.

## Pricing invariant
The client never controls the authoritative sale price. The server loads `selling_price` from each actual FEFO batch used by the transaction. Client quotes are informational and checkout fails if current server state no longer matches the submitted payment total.

## Stock invariant
Completed sales post negative `SALE` movements to the immutable inventory ledger. Refunds post positive `RETURN_IN` movements against the original batch. Expired, recalled, quarantined and disposed stock cannot enter the FEFO checkout path.

## Refund invariant
A refund cannot exceed the original sold quantity after subtracting prior refunds. Refunds never rewrite the original sale or original inventory movement. They add compensating financial/refund records and compensating inventory movements.

## Sprint 6 regression coverage
`supabase/tests/sprint6_pos_sales.sql` covers FEFO multi-batch pricing, expired-batch exclusion, sale idempotency, payment mismatch rollback, cashier refund denial, authorized partial refund and return-to-stock ledger behavior.
