# UX & Localization Specification

## Staff Web screen map
- W-001 Login: email/password, reset, language, auth states.
- W-002 Branch Selector: authorized branches and current context.
- W-003 Dashboard: sales, inventory, expiry risk, purchasing, Exchange/reservations when enabled, quick actions.
- W-004 Product Catalogue: search/filter/products/import/archive.
- W-005 Product Detail: overview, batches, movements, purchasing, sales, future Exchange.
- W-006 Product Create/Edit: identity/commercial/classification/settings, duplicate barcode warning.
- W-007 Inventory Overview: value, low/out-of-stock, available/reserved, expiry.
- W-008 Stock Movement Ledger: immutable operational journal.
- W-009 Stock Adjustment: batch, quantity, reason, before/after, approvals where configured.
- W-010 Expiry Center: threshold cards, days remaining, value at risk, recommended actions.
- W-011 Suppliers; W-012 Supplier Detail.
- W-013 Purchase Orders; W-014 Create PO; W-015 Receive Purchase with partial receiving and lot/expiry.
- W-016 POS New Sale; W-017 Payment; W-018 Receipt; W-019 Sales History; W-020 Refund.
- W-021 Customers; W-022 Customer Detail.
- W-023 Exchange Marketplace; W-024 My Listings; W-025 Create Listing; W-026 Requests; W-027 Transfer.
- W-028 Branch Transfers.
- W-029 Reservations; W-030 Availability Requests.
- W-031 Reports.
- W-032 Staff; W-033 Role/Permission Detail.
- W-034 Notification Center; W-035 Preferences.
- W-036 Import Wizard.
- W-037 Settings.
- W-038 Audit Log.

## Mobile staff screens
- M-001 Home: sales/low stock/expiry/reservations/Exchange cards and Scan/Sell/Receive/Search actions.
- M-002 Barcode Scanner: product, quantity, batches, expiry, price and context actions.
- M-003 Inventory Search.
- M-004 Product Detail.
- M-005 Quick Sale.
- M-006 Receive Stock.
- M-007 Expiry Alerts.
- M-008 Stock Count with variance/approval.
- M-009 Exchange mobile tabs.
- M-010 Reservation actions.

Mobile is not a shrunken desktop. Prioritize scanning, quick sale, lookup, receiving, stock count and alerts. Desktop prioritizes large tables, reports, imports and administration.

## Customer/public experience
- C-001 Medicine Search Home: medicine + optional location, no account required for basic search.
- C-002 Results: pharmacy, distance where available, public availability, reservation, price only if published.
- C-003 Pharmacy Detail: address/hours/contact/directions and relevant public result only.
- C-004 Reservation Request: contact/language/quantity/consent; request is not confirmed until pharmacy accepts.
- C-005 Reservation Status.
- C-006 Notify Me.
- C-007 Customer Notifications.

## UX state requirements
Every data-driven form/list handles Loading, Empty, Success and Error states where applicable. High-risk/destructive actions require confirmation. Authorization remains backend/database-enforced.

## Localization
Required locales: `en`, `fr`. No hard-coded user-facing strings. Recommended package namespaces: common, auth, inventory, purchasing, sales, customers, exchange, locator, reservations, reports, settings, errors.

Internal codes remain language-neutral and are translated at presentation time.

## Core glossary
| English | French |
|---|---|
| Pharmacy | Pharmacie |
| Branch | Succursale |
| Dashboard | Tableau de bord |
| Inventory | Stock |
| Product | Produit |
| Medicine | Médicament |
| Batch / Lot | Lot |
| Batch Number | Numéro de lot |
| Expiry Date | Date de péremption |
| Expiring Soon | Expire bientôt |
| Expired | Périmé |
| Low Stock | Stock faible |
| Out of Stock | Rupture de stock |
| Available Stock | Stock disponible |
| Reserved Stock | Stock réservé |
| Stock Movement | Mouvement de stock |
| Stock Adjustment | Ajustement de stock |
| Stock Count | Inventaire physique |
| Purchase Order | Bon de commande |
| Supplier | Fournisseur |
| Receiving | Réception |
| Sale | Vente |
| Payment | Paiement |
| Receipt | Reçu |
| Refund | Remboursement |
| Customer | Client |
| Reservation | Réservation |
| Availability | Disponibilité |
| Notify Me | Me prévenir |
| Exchange Network | Réseau d’échange |
| Exchange Listing | Offre d’échange |
| Transfer | Transfert |
| Manufacturer | Fabricant |
| Generic Name | Dénomination générique |
| Brand Name | Nom commercial |
| Strength | Dosage |
| Dosage Form | Forme pharmaceutique |
| Barcode | Code-barres |
| Purchase Price | Prix d’achat |
| Selling Price | Prix de vente |
| Audit Log | Journal d’audit |
| Settings | Paramètres |
| Reports | Rapports |
| Subscription | Abonnement |

## Status localization
Store `ACTIVE`, `QUARANTINED`, `RECALLED`, `EXPIRED`, `DEPLETED`, `DISPOSED`; translate to Active/Actif, Quarantined/En quarantaine, Recalled/Rappelé, Expired/Périmé, Depleted/Épuisé, Disposed/Mis au rebut.

Purchase order internal statuses: `DRAFT`, `APPROVED`, `SENT`, `PARTIALLY_RECEIVED`, `RECEIVED`, `CANCELLED`.

Exchange: `REQUESTED`, `APPROVED`, `PARTIALLY_APPROVED`, `PREPARING`, `IN_TRANSIT`, `RECEIVED`, `COMPLETED`, `CANCELLED`, `REJECTED`, `DISPUTED`.

Reservation: `REQUESTED`, `ACCEPTED`, `READY`, `COLLECTED`, `EXPIRED`, `CANCELLED`, `REJECTED`.

## Formatting
Store ISO currency code (e.g. XOF) and configure display such as `35 000 FCFA`. Numbers/dates use locale-aware formatting. For safety-sensitive expiry displays prefer unambiguous forms such as `30 Sep 2026` / `30 sept. 2026`.

## Public wording
Avoid guarantees when inventory can change. Example: “Reported in stock” / “Signalé disponible”. Reservation copy must state the medicine is not reserved until pharmacy confirmation. Availability alerts should say availability may change.

## Accessibility
Meaningful labels, keyboard support on Web, screen-reader semantics, adequate touch targets, scalable text and no status communicated solely by color.
