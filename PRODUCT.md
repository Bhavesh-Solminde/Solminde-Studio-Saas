# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Front-desk cashier — the primary operator.** Runs the POS at the counter during salon
  hours, frequently with the internet down. Registers walk-ins, bills services and
  products, redeems wallet and package sessions, takes payment, prints the receipt. Judges
  the product on one thing: the delay between tapping **Save Bill** and the receipt
  printing. Works under in-person pressure with a customer standing in front of them, so
  speed and accuracy outrank every other consideration.
- **Salon owner / manager — the buyer.** Sets commission structures, prices and feature
  toggles; reads reports; runs day-close and cash reconciliation; edits the public site
  content; manages staff and roles. Buys on commission clarity and on billing that does not
  stop when the internet does.
- **Stylist.** Marks attendance, sees **their own** commission and nothing else. The
  `commission.view_own` / `commission.view_all` split is a hard requirement, not a nicety:
  a stylist seeing colleagues' earnings causes real fights on the salon floor.
- **The salon's customers.** Use the public salon website to discover services and book
  online; receive confirmations, reminders and bills over WhatsApp. They never log into the
  POS — all records are staff-managed.

## Product Purpose

An offline-first, multi-tenant salon management system for the Indian market. One codebase,
sold as a bespoke install per salon, each with its own public website.

The system runs the salon's whole operating day — billing, appointments, customers,
inventory, staff, commissions, packages and memberships — and it keeps running when the
salon's internet drops, which it does.

**Success:** the front desk creates a bill, redeems wallet, deducts stock, and prints a
receipt carrying a **final** invoice number with the router unplugged; when the connection
returns, everything syncs, the ledgers balance, and nothing duplicates.

Two places where perfection is mandatory:

- **Money and stock must never be wrong.**
- **Offline data must never be lost.**

Everything else ships rough and gets fixed by customer complaints. Aiming for perfect
everywhere means shipping nothing.

## Positioning

Three claims a neighbouring product could not truthfully copy:

1. **Billing works offline.** Competitors are web apps; when salon internet dies they stop
   taking money. This one does not. This is the pitch, and §5's works-offline table is the
   sales deck.
2. **Hands-on onboarding.** We show up, enter their 800 customer records, and train the
   front desk. Indian salons churn on incomplete onboarding, not on missing features.
3. **Commission clarity.** Stylist commission disputes are a top-three operational pain.
   The product solves it precisely — flat %, slab, service vs retail split, target bonuses —
   and shows each stylist only their own number.

**Permanently out of scope**, recorded so they stop being re-proposed: AI receptionist or
voice agents · franchise royalty modelling · statutory payroll (PF, ESI, TDS) · reputation
management across review platforms · native iOS/Android apps · medspa clinical charting and
HIPAA compliance.

The reference competitor has ~240 engineers and a 16-year head start. This is not a clone
of it, and scope discipline is a product decision, not an engineering one.

## Operating Context

- **Market:** independent salons and small chains in Mumbai. India — INR, GST,
  Asia/Kolkata.
- **Physical setup:** mostly ten chairs or fewer, running **exactly one billing counter**.
  Multi-terminal and multi-branch are supported by the data model but are not the common
  case. Hardware is typically a 4 GB i3 desktop.
- **Network:** intermittent. Sustained multi-hour outages during business hours are normal,
  not exceptional, and the product is designed around that fact rather than in spite of it.
- **The walk-in loop:** customer arrives → front desk looks up or registers them → adds
  services and products → applies wallet, package sessions or discount → takes split /
  partial payment → prints a thermal receipt with a final invoice number.
- **Printing:** ESC/POS byte streams pushed over Web Serial (USB) or Web Bluetooth, with an
  HTML print view as fallback. Not `window.print()` — the print dialog is the slowest step
  in the flow.
- **Invoice numbering:** GST invoice series are leased to each terminal in blocks ahead of
  time, so a number printed offline is final and collision is impossible. GST permits
  multiple series per place of business, but **the client's CA confirms the format before
  go-live.** We are not tax advisors.
- **Payments:** cash, UPI, card, split and partial; Razorpay for payment links and QR.
- **Messaging:** WhatsApp — see Capabilities for the two-provider arrangement.
- **Salon hours:** roughly 9am–10pm, seven days. Infrastructure keep-warm is scheduled
  around this window.
- **Team:** three people, split by ownership rather than by task — Lane A (sync engine,
  ledgers, tenancy/RLS, auth, entitlements, permissions, deployment — the critical path),
  Lane B (billing, POS, printing, commissions, packages, day-close, refunds — the revenue
  surface), Lane C (appointments, online booking, WhatsApp, reports, CMS, theming — the
  growth surface). Scope must be arranged so P0 survives losing one person for six weeks.

## Capabilities and Constraints

### Confirmed scope — required to sell (P0)

**Operations:** dashboard (today's revenue, appointments, staff on floor) · customer
database with visit history, notes and tags · appointment book with day/week grid and
drag-to-reschedule · stylist and resource (chair/room) conflict checking · service catalog
with categories, durations and variable pricing · products and inventory with reorder
alerts · employees and daily attendance.

**Money:** billing across services and products with GST, split payment and wallet
redemption · bill history, expense tracking, CSV export · **commission engine** (flat %,
slab, service vs retail, target bonuses) · prepaid packages and session courses ·
memberships and wallet · advances, dues, partial payments · refunds and bill cancellation
**as reversing entries** · Razorpay, UPI QR and payment links · day-close and cash
reconciliation.

**Infrastructure:** multi-tenancy enforced by row-level security · RBAC with roles plus
per-user overrides · entitlements / feature toggles · audit log · onboarding wizard and CSV
import · per-tenant branding, logo and invoice prefix · theming · Exceptions and Conflicts
screens.

**Customer-facing:** public salon website driven by a section-based CMS · online booking
with live slot availability · WhatsApp for booking confirmation, 24-hour reminder, bill and
birthday message.

**Reporting:** date-range reports with CSV export · revenue per stylist · chair and staff
utilisation · retail attachment % · client retention and lapsed-client win-back list · GST
summary (GSTR-1 ready export).

### Confirmed deferrals (P1 / post-launch)

Loyalty points, gift cards, referrals, tips capture and payout, multi-location roll-up
reporting, customer self-service portal, Google review automation, our own subscription
billing, shift rostering, waitlist, recurring appointments. None of the first three clients
will ask for these before the CMS.

### Hard invariants — these constrain every future decision

1. **No running total is ever stored.** Wallet balance, stock quantity and package sessions
   remaining are `SUM(delta)` over append-only ledgers. Offline merging is then addition,
   and addition commutes — two devices syncing in any order reach the same number.
2. **Ledger entries are immutable.** No `UPDATE`, no `DELETE`. A mistake is corrected by
   posting a reversing entry. A bill void is a new row, not a mutation. The audit log comes
   free.
3. **Every write carries an `op_id` and is idempotent.** The same op arriving twice returns
   the stored result and does nothing else. Without this, flaky 4G produces duplicate bills,
   and duplicate bills lose the client.
4. **The billing path never awaits the network.** Local write, local outbox, render receipt,
   done — a background worker syncs later. Perceived latency is a Dexie write, not a round
   trip.
5. **Overdrafts are allowed offline, detected on sync.** Two terminals redeeming more wallet
   than exists cannot be prevented offline, so it is not blocked — it is surfaced on the
   Exceptions screen with an Adjust / Write-off decision for the owner.
6. **Entitlements and permissions are two different systems.** Entitlements answer "does
   this *salon* have Packages?" (set by us). Permissions answer "may this *stylist* void a
   bill?" (set by the owner). Both are enforced server-side on every mutating route.
   Conflating them is a security bug.
7. **Disabling a feature that holds data is read-only, never destructive.** A salon turning
   off Packages while holding ₹80,000 of unredeemed sessions keeps those sessions
   redeemable; only new sales stop. The toggle warns with the real numbers first.
8. **A network failure never destroys local state**, including authentication. The local
   session (12–24h, device-bound) is a separate concept from the API access token (15 min);
   the UI checks the local session. The front desk is never logged out mid-bill.

### What works offline

| Works fully offline | Requires network |
|---|---|
| Billing — create, print, tender | WhatsApp send (queued, fires on reconnect) |
| Appointments — view, book, edit, cancel | Razorpay / UPI collection |
| Customer lookup and history (90-day cache) | Online booking by customers |
| Stock deduction | Reports beyond the local cache |
| Wallet redemption | Settings and price changes (read-only offline) |
| Package session redemption | Feature toggles |
| Attendance marking | Adding a new staff member |

This table is also the sales deck.

### Commercial model — confirmed

**Bespoke install plus annual AMC.** No public price list. Every client gets a negotiated
feature set, so `features.default_tier` stays a single `standard` baseline and the real
lever is the per-tenant override. Resolution order remains plan default → tenant override →
trial, and `expires_at` is built now even though trials are not used immediately —
entitlements are the pricing mechanism, not merely an off-switch.

Hosting runs roughly ₹1,500–2,500/month once 5–10 salons are live. This is priced into AMC
from client #1.

### WhatsApp — two providers, toggleable per tenant — confirmed

1. **One-click send (default, and what every client gets on day one).** A `wa.me` deep link
   opens WhatsApp Web or the desktop app with the message pre-filled to the customer's
   number; staff press Send themselves. Proven in the POSH prototype. No Business
   verification, no template approval, no per-message cost, no BSP dependency, and it uses
   the salon's own WhatsApp number.
2. **Meta WhatsApp Cloud API (opt-in upgrade).** True automation — unattended booking
   confirmations, 24-hour reminders, birthday messages, bill delivery. Requires Business
   verification and template approval per client.

Both ship behind one provider interface and are switched by a per-tenant feature toggle, so
a salon that wants automation later is a configuration change rather than a rewrite. The
manual provider is the fallback whenever the automated one is unavailable.

### Explicitly undecided — do not invent

- The GST invoice-series format for each client — pending that client's CA.
- The exact thermal printer model of the pilot client. Every printer model lies about its
  spec sheet; the physical unit is acquired before anything is designed around it.
- AMC pricing and the one-time install fee.
- Which specific features are withheld from a baseline install versus sold as add-ons.

## Brand Commitments

- **Name:** **Solminde Studio** — the studio identity this platform ships under. A separate
  salon-facing product name has not been established; docs, configs and package names use
  `salon-platform` until one is.
- **The POSH Salon identity — Bodoni serif, gold `#C7A24B`, cream — belongs to the
  prototype's single client, not to this product.** It must not be carried into this
  platform's chrome. This product is sold to many salons; each tenant supplies its own
  identity through theming and its own site content.
- **Tenant identity is data, not design.** Logo, primary colour, invoice prefix and site
  content are per-tenant configuration owned by the salon owner.
- **User-stated, binding** (recorded as given; the visual system that delivers them is
  decided in DESIGN.md, not here):
  - The admin dashboard must **feel safe and trustworthy**.
  - It must **not look AI-made**.
  - It must be **easy to use, not complicated**.
  - Palette is pinned: **blue and yellow controls on a greyed-white ground**; modern,
    professional.

## Evidence on Hand

**Available:**

- **The POSH Salon prototype** at `../POSH salon/` — a running Next.js application built
  for one real salon in Bahadurgarh, Haryana, with real business data
  (`src/lib/business.ts`), a real logo, membership/wallet ledger, inventory movements and
  invoicing already proven against a live client. It is the domain validation that precedes
  this platform, the source of the one-click WhatsApp pattern, and the **Stage 7 pilot
  migration target**. It is not a code source and not a design reference.
- **The build specification** at `SALON_PLATFORM_BUILD_SPEC.md` — the architectural
  authority for the ledger model, sync engine, tenancy, entitlements and build order.

**Not available — must not be fabricated:** tenant photography, customer testimonials or
reviews, per-salon service catalogues and prices, GST registration details, and any pricing
or licensing claim. Tenant sites ship clearly-marked placeholders until each salon supplies
real assets.

## Product Principles

1. **Money and stock are never wrong; offline data is never lost.** These two are
   non-negotiable. Everything else ships rough and is fixed by customer complaints.
2. **Never store a balance — store a ledger.** Addition commutes; overwrites do not. This
   single decision is what makes offline sync tractable, and reversing it later means
   rebuilding the product.
3. **Never await the network on a user-facing path.** A spinner on an operation that touches
   only local storage is a bug, not a loading state. A spinner teaches the front desk the
   app is slow even when it isn't.
4. **Hiding UI is not access control.** Feature and permission guards live on the server, on
   every mutating route, from day one. Client-side hiding exists only so the UI isn't
   confusing.
5. **Failures surface, they never disappear.** Overdrafts, negative stock, permission
   violations and double-bookings go to the Exceptions or Conflicts screen with a human
   decision attached. Nothing is silently dropped, and nothing is silently resolved.

## Accessibility & Inclusion

- Public tenant sites target **WCAG 2.1 AA** — contrast, keyboard operation, visible focus,
  alt text.
- **Tenant theming enforces AA rather than trusting it.** The system computes contrast
  against text colour and auto-flips foreground to white or black on failure. A salon owner
  must not be able to configure an unreadable dashboard, so colour choice is restricted to a
  small preset set plus one custom value.
- **The POS is keyboard-first.** The front desk works faster than a mouse allows; every
  billing action is reachable without pointing.
- Target hardware is a 4 GB i3 desktop at 1366×768. Interfaces must remain usable and
  legible at that size and speed.
- English at launch.
