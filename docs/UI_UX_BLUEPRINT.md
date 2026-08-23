# UI/UX Blueprint

## Product experience goal
Create one coherent pharmacy operations product with platform-appropriate presentation across desktop Web, tablet/mobile Web/PWA, iOS and Android. The current screens are functional references, not the final design ceiling.

## Reference products reviewed
Use these products as workflow and interaction references, never as visual clones.

### Sortly
Borrow:
- simple inventory information hierarchy
- search-first navigation
- compact mobile item cards
- obvious stock/min-level presentation
- barcode-friendly interactions
- confidence-building offline states

Do not inherit its generic-business vocabulary. Pharmacy Stock must remain pharmacy-specific.

### PrimeRx / PrimeINVENTORY / PrimeRx POS
Borrow:
- pharmacy-specific search and stock workflows
- rapid `search/scan → quantity → action` interactions
- focused POS behavior
- camera/barcode-first mobile flows

Avoid a fragmented multi-app feeling. Pharmacy Stock should remain one coherent product.

### PioneerRx Mobile Inventory
Borrow:
- shelf-side operational workflows
- receiving, counting and barcode-first task orientation
- mobile navigation centered on concrete pharmacy tasks

Do not copy its dated visual styling. Use the workflow lessons only.

### Odoo Inventory + Barcode
Borrow:
- responsive operational density on desktop
- list/detail and table workflows
- barcode-centered receipts, deliveries and transfers
- adaptive PWA behavior across desktop and mobile

Avoid ERP complexity. Progressive disclosure must keep Pharmacy Stock simpler and faster for frontline pharmacy staff.

### Combined design direction
The intended product direction is:

**Sortly clarity + PrimeRx pharmacy speed + PioneerRx task focus + Odoo responsive/PWA structure.**

The result must look and behave as a distinct DohouLabs Pharmacy Stock design system rather than a derivative interface.

## Design principles
- Operational clarity beats decorative density.
- High-frequency actions should be reachable quickly.
- Stock state, expiry risk, payment state and sync state must be unmistakable.
- Never encode critical status by color alone.
- Preserve fast scanning/keyboard workflows for pharmacy counters.
- Mobile experiences should feel intentionally mobile, not compressed desktop pages.
- French and English must both fit without broken layouts.
- Connectivity state must be visible whenever stale or pending data could affect a decision.
- Use progressive disclosure so powerful workflows do not become ERP-like clutter.

## Shared app shell
### Desktop Web
Use a persistent left navigation or equivalent wide-screen shell with:
- pharmacy/branch context
- global search/scan entry
- navigation groups
- connectivity/sync status
- notifications
- profile/settings

Main content should use a bounded but generous canvas. Dense workflows can use list/detail split panes and tables.

### Tablet
Collapse navigation into a narrower rail/drawer. Prefer two-column content only where comfortable.

### Mobile Web/PWA + native
Use touch-first navigation. A bottom navigation pattern is suitable for the most frequent destinations, with secondary functions in a menu/drawer. Avoid exposing every administrative route at once.

Mobile primary workflows should bias toward task entry points such as Scan, Search, Receive, Count, Transfer and Sell rather than mirroring the complete desktop menu tree.

## Suggested information architecture
Primary operational areas:
- Home / Dashboard
- POS
- Inventory
- Purchasing
- Expiry
- Transfers
- Reports

Secondary/administrative areas:
- Products & batches
- Customers
- Suppliers
- Staff & branches
- Imports
- Notifications
- Settings
- Subscription
- Audit

Future P1 network areas should be added deliberately rather than crowding the core navigation.

## Dashboard
Dashboard should answer immediately:
- What needs attention today?
- Is the pharmacy online and synchronized?
- What is low/out of stock?
- What is expiring soon?
- Are any purchase receipts/transfers waiting?
- What are today's sales headline numbers?

Use actionable cards rather than vanity charts.

## POS
### Desktop/tablet
Preferred layout:
- product search/scan region
- large cart/items pane
- totals/payment pane
- keyboard-friendly quantity controls
- clear stock/expiry feedback

Support barcode scanner keyboard input naturally. High-frequency actions need shortcuts where feasible.

### Mobile/native
Use a scan/search-first screen, cart as an obvious persistent destination, then focused checkout/payment steps.

### Offline POS UX
Always show whether the sale is:
- synchronized
- pending sync
- conflicted

Offline receipts must clearly state `Pending sync` until accepted by the server.

## Inventory
Desktop should use filterable tables with product, batch, lot, expiry, on-hand quantity, status and value where authorized.

Mobile should show compact cards/list rows with drill-down details. Make scan-to-product/batch easy.

Stock count should be a focused workflow with progress, draft persistence and clear completion consequences.

## Purchasing and receiving
Separate the mental models:
- Suppliers
- Purchase Orders
- Receiving
- Receipt History

Desktop may use tabs/list-detail. Mobile should use focused screens.

Receiving should emphasize:
- product
- ordered/previously received/remaining quantity
- received quantity
- lot number
- expiry date
- purchase cost
- validation and partial-receipt status

## Expiry Center
Prioritize urgency:
- expired
- within 7 days
- 30/60/90/etc. according to configured thresholds

Expose monetary value at risk where permitted. Controlled actions such as quarantine, release, supplier return and disposal need clear confirmations and audit context.

## Transfers
The transfer lifecycle should be visually explicit:
`Requested → Approved → Dispatched → Received`
with discrepancy and cancellation states clearly represented.

Source and destination branch must remain prominent. For receipt discrepancies, show dispatched vs received side-by-side.

## Reports
Desktop can use date filters, tables and charts where they genuinely improve comprehension. Mobile should prioritize headline values and drill-down lists.

Do not build charts merely because space exists.

## Offline and synchronization UX
A persistent global indicator is required.

Examples:
- `Online · Synced`
- `Syncing 2 changes…`
- `Offline · last synced 14:32`
- `3 changes pending`
- `1 conflict`

Record-level pending state should also be visible in lists/history. Never let a user assume a locally queued transaction already reached the pharmacy server.

## State patterns
Every data-driven screen should intentionally design:
- loading/skeleton
- empty state with useful next action
- success/data state
- validation errors
- authorization denied
- server/network error
- offline cached state
- stale data state
- pending-sync state
- conflict state

## Forms
- persistent labels, not placeholder-only forms
- inline validation with localized messages
- sensible numeric keyboards on mobile
- date inputs appropriate per platform
- destructive actions separated from primary actions
- preserve drafts where losing work would be costly

## Tables and lists
Desktop tables should support useful filtering/sorting/search, sticky headers where appropriate and compact row density.

On narrow screens, transform into structured cards/list rows rather than forcing horizontal scrolling for primary workflows.

## Touch and keyboard targets
- mobile touch targets should be comfortably tappable
- desktop POS should be efficient by keyboard and barcode scanner
- focus indicators must be visible on Web

## Accessibility
- semantic headings/labels
- screen-reader descriptions for status badges and action buttons
- scalable type
- sufficient contrast
- status not color-only
- modal focus management on Web
- announce significant async outcomes where platform APIs permit

## Visual system
Create reusable tokens/components for:
- spacing
- typography hierarchy
- border radius
- surfaces
- semantic status colors
- buttons
- inputs
- badges
- cards
- tables
- modal/sheet patterns
- empty/error/offline states

Avoid scattering raw style values throughout screens. Existing colors can inform the first pass, but consolidate them into a maintained theme/design-token layer.

## Responsive breakpoints
Use behavior-oriented breakpoints rather than device-brand assumptions. At minimum design for:
- narrow phone
- wide phone/small tablet
- tablet/small laptop
- desktop
- wide desktop

The exact pixel values can be chosen during implementation, but every key screen must be reviewed at all five classes.

## Localization review
French strings are often longer than English. Verify:
- buttons do not truncate critical labels
- tables/cards expand gracefully
- tabs/navigation remain understandable
- dates/currency follow locale rules

## Production acceptance for a screen
A screen is not production-finished until it is:
- responsive
- keyboard/touch accessible as applicable
- EN/FR complete
- permission-aware
- offline-state aware
- loading/empty/error aware
- consistent with the shared design system
- verified on Web, iOS and Android form factors
