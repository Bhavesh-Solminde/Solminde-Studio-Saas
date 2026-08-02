# Salon Platform — Build Specification

Offline-first, multi-tenant salon management system for the Indian market.
One codebase, sold as bespoke installs, with a public website per client.

---

## Table of Contents

1. [Product Thesis](#1-product-thesis)
2. [Architecture Overview](#2-architecture-overview)
3. [The Ledger Model](#3-the-ledger-model-read-this-first)
4. [The Sync Engine](#4-the-sync-engine)
5. [Offline Behaviour Spec](#5-offline-behaviour-spec)
6. [Performance & Perceived Speed](#6-performance--perceived-speed)
7. [Multi-Tenancy & Security](#7-multi-tenancy--security)
8. [Entitlements & Permissions](#8-entitlements--permissions)
9. [Data Model](#9-data-model)
10. [Feature Inventory](#10-feature-inventory)
11. [Theming](#11-theming)
12. [Landing Page CMS](#12-landing-page-cms)
13. [Build Chronology](#13-build-chronology)
14. [Team Split](#14-team-split)
15. [Infrastructure & Deployment](#15-infrastructure--deployment)
16. [Definition of Done](#16-definition-of-done)
17. [Known Traps](#17-known-traps)

---

## 1. Product Thesis

### What we are building

A salon management system that keeps billing working when the internet dies,
sold to independent salons and small chains in Mumbai. One multi-tenant
codebase, delivered as a "custom" install per client.

### What we are NOT building

Zenoti has ~240 engineers and 16 years of head start. We are not cloning it.
Explicitly out of scope, permanently:

- AI receptionist / voice agents
- Franchise royalty modelling
- Statutory payroll (PF, ESI, TDS)
- Reputation management across review platforms
- Native iOS/Android apps
- Medspa clinical charting / HIPAA compliance

### Where we win

1. **Offline billing.** Salon internet drops. Competitors' web apps stop
   taking money. Ours does not. This is the pitch.
2. **Hands-on onboarding.** We show up, enter their 800 customer records,
   train the front desk. Indian salons churn on incomplete onboarding, not
   on missing features.
3. **Commission clarity.** Stylist commission disputes are a top-three
   operational pain. We solve it precisely.

### The two places perfection is mandatory

- **Money and stock must never be wrong.**
- **Offline data must never be lost.**

Everything else ships rough and gets fixed by customer complaints. Aiming for
perfect everywhere means shipping nothing.

---

## 2. Architecture Overview

### Repository layout

```
salon-platform/
├── apps/
│   ├── pos/          Vite + React PWA      — admin dashboard, offline-first
│   ├── web/          Next.js (App Router)  — public salon sites + booking
│   └── api/          NestJS + Prisma       — all server logic
├── packages/
│   └── shared/       types, zod schemas, money/GST calc, ledger rules
├── pnpm-workspace.yaml
└── .npmrc
```

### Stack decisions and why

| Layer | Choice | Reason |
|---|---|---|
| Admin/POS | Vite + React + TS | Must run with zero server. Next.js server features are unusable offline; Vite dev server stays fast as the app grows |
| Public site | Next.js App Router | SSG/ISR, SEO, per-tenant custom domains, image optimisation |
| Local DB | Dexie.js over IndexedDB | Enough power without SQLite-WASM/OPFS complexity |
| Service worker | vite-plugin-pwa (Workbox) | `next-pwa` is unmaintained; Serwist only needed if forced into Next |
| Backend | NestJS | DI container makes tenant context, transactions and testing tractable. Module boundaries enforce the three-lane team split |
| ORM | Prisma | Better DX and type safety than TypeORM. Domain logic lives in our own classes, so plain-type entities cost nothing |
| Database | Postgres on **Supabase, `ap-south-1` (Mumbai)** | Transactions and `SUM()` over ledgers are non-negotiable. Mongo is the wrong tool here. Supabase over Neon purely on region — see §6 |
| Package manager | pnpm workspaces | Blocks phantom dependencies structurally — the most common monorepo bug when three people share one `packages/shared` |
| Payments | Razorpay | Standard in India |
| Messaging | Meta WhatsApp Cloud API (or AiSensy/Interakt to launch faster) | |

### Package manager setup

`.npmrc` at repo root:

```
node-linker=isolated
shamefully-hoist=false
```

Run strict (isolated) locally so undeclared imports fail immediately.
Only switch to `node-linker=hoisted` if a Docker build or a postinstall
script breaks under strict resolution.

Do **not** add Turborepo. Its caching solves a problem three developers
do not have, and it is one more thing to debug at 1am.

---

## 3. The Ledger Model (read this first)

This single decision makes offline sync tractable. Everything else in the
system depends on it. Get it wrong and the whole build has to be redone.

### The problem

The naive approach stores balances:

```sql
customers.wallet_balance = 600
```

Two terminals go offline. Both redeem ₹500. Both write `balance = 100`.
₹500 has vanished and there is no way to reconstruct the truth.

### The rule

**Never store a running total. Always store an append-only ledger.**

```sql
wallet_ledger(id, tenant_id, customer_id, delta, reason,
              bill_id, terminal_id, op_id, created_at)

balance = SUM(delta) WHERE customer_id = ?
```

Offline merging becomes **addition**. Addition commutes — two devices syncing
in any order land on the same number. Nothing is ever overwritten.

### Apply to everything that is a running total

| Never store | Store instead |
|---|---|
| `product.stock_qty` | `stock_ledger` (+purchase, −sale, ±adjustment, −damage) |
| `customer.wallet_balance` | `wallet_ledger` |
| `package.sessions_left` | `session_ledger` |
| `staff.commission_earned` | derived from bill lines at read time |

### Ledger entries are immutable

No `UPDATE`, no `DELETE`, ever. A mistake is corrected by posting a
**reversing entry** with a `reverses_id` pointer. This gives the audit log
for free and means a bill void is a new row, not a mutation.

### Performance

`SUM()` over a ledger is fast until it isn't. When a tenant crosses roughly
100k rows in one ledger, add periodic **snapshot rows**:

```sql
ledger_snapshots(tenant_id, owner_id, ledger_type,
                 balance_at, as_of_entry_id, created_at)
```

Balance = latest snapshot + `SUM(delta)` of entries after it. Do not build
this until measurement says you need it.

### The abstraction

```ts
abstract class Ledger<T extends LedgerEntry> {
  abstract table: string;

  async balance(tx: Tx, ownerId: string): Promise<number>
  async post(tx: Tx, entry: T): Promise<void>          // append-only
  async reverse(tx: Tx, entryId: string, reason: string): Promise<void>
  async wouldOverdraw(tx: Tx, ownerId: string, delta: number): Promise<boolean>
}

class WalletLedger  extends Ledger<WalletEntry>  { table = 'wallet_ledger' }
class StockLedger   extends Ledger<StockEntry>   { table = 'stock_ledger' }
class SessionLedger extends Ledger<SessionEntry> { table = 'session_ledger' }
```

Three ledgers, one set of invariants, one place to fix a bug.

### The one thing that does not commute: overdraft

Two offline terminals redeem more wallet than exists, or sell stock that
isn't there. This cannot be prevented offline.

**Do not block it.** Let it through, detect it server-side on sync, surface
it on an **Exceptions** screen:

> Wallet for Priya S. went negative ₹200 on 12 Aug — two bills from
> Counter A and Counter B. [Adjust] [Write off]

Reality check: most salons under 10 chairs run exactly one billing counter.
With one terminal this conflict class has near-zero probability. Design for
it anyway — it is cheap once ledgers exist, and it unlocks multi-branch
clients later.

---

## 4. The Sync Engine

Two independent channels. Do not attempt to merge them into one mechanism.

### Push: the outbox

Every user write goes into a local operations table **before** touching
local state.

```ts
interface OutboxOp {
  op_id:      string;   // UUID generated on device — the idempotency key
  tenant_id:  string;
  terminal_id: string;
  local_seq:  number;   // monotonic per terminal, preserves ordering
  type:       string;   // 'bill.create' | 'appointment.book' | 'stock.adjust'
  payload:    unknown;
  status:     'pending' | 'sent' | 'acked' | 'rejected';
  attempts:   number;
  created_at: number;
}
```

Flow:

1. User action → write op to outbox
2. Apply optimistically to local Dexie state (front desk never waits)
3. Background worker drains outbox in `local_seq` order when online
4. Server acks → mark `acked` → prune after a retention window

### Idempotency — the most important table in the system

Server keeps:

```sql
processed_ops(op_id UUID PRIMARY KEY, tenant_id UUID,
              result JSONB, created_at TIMESTAMPTZ)
```

If the same `op_id` arrives twice — flaky 4G, retry storm, user
double-tapping — it returns the stored result and does nothing else.

Without this you get duplicate bills. Duplicate bills lose you the client.

### The handler registry

```ts
abstract class OpHandler<P> {
  abstract type: string;                  // 'bill.create'
  abstract schema: ZodSchema<P>;
  abstract requiredFeatures: string[];
  abstract requiredPermissions: string[];
  abstract apply(tx: Tx, ctx: TenantCtx, payload: P): Promise<OpResult>;
}

@Injectable()
class BillCreateHandler extends OpHandler<BillCreatePayload> {
  type = 'bill.create';
  requiredFeatures = ['billing'];
  requiredPermissions = ['bill.create'];
  // ...
}
```

`POST /sync/push` algorithm, per op, inside one transaction:

```
1. Check processed_ops for op_id  → if found, return stored result
2. Look up handler by op.type     → if unknown, reject
3. Validate payload against schema
4. Check entitlements (tenant has feature)
5. Check permissions (user may do this)
6. handler.apply(tx, ctx, payload)
7. Insert into processed_ops
8. Commit
```

Adding a new syncable operation is **one new class and zero changes to the
sync engine**. This is what lets two developers add operation types in
parallel without conflicts.

### Pull: cursor sync

Every server row carries `updated_at` and `row_version`.

```
GET /sync/pull?since=<cursor>&tables=services,products,customers,staff,roles
→ { changes: [...], tombstones: [...], cursor: <new>, serverTime: ... }
```

- Deletes go to a `tombstones` table, never hard-deleted, or clients can
  never learn about them
- Reference data (services, prices, staff, customers, roles, features) is
  **server-authoritative — last-write-wins is correct**, the owner edits
  from one place
- Transactional data flows the other way and is **never** overwritten by
  the server

### Sync worker behaviour

- Trigger on: `online` event, app focus, every 60s while online, and
  immediately after any outbox write if online
- Exponential backoff on failure: 2s, 4s, 8s … cap at 5 min
- Batch pushes in groups of ~50 ops
- Never block the UI on sync

---

## 5. Offline Behaviour Spec

### What works offline

| Works fully offline | Requires network |
|---|---|
| Billing (create, print, tender) | WhatsApp send (queued, fires on reconnect) |
| Appointments — view, book, edit, cancel | Razorpay / UPI collection |
| Customer lookup + history (90-day cache) | Online booking by customers |
| Stock deduction | Reports beyond local cache |
| Wallet redemption | Settings and price changes (read-only offline) |
| Package session redemption | Feature toggles |
| Attendance marking | Adding a new staff member |

Put this table in the sales deck. "Billing keeps working when your internet
dies" is a stronger pitch than any single feature the competition has.

### Invoice numbering — pre-leased blocks

The customer walks out with a printed bill. The number on it must be final;
it cannot be assigned later on sync.

```sql
invoice_leases(tenant_id, terminal_id, series, financial_year,
               block_start, block_end, next_number)
```

- Terminal A leases `POSH/26-27/A/0001–0300`
- Terminal B leases `POSH/26-27/B/0001–0300`
- Consumed locally, collision impossible
- Re-lease automatically at 80% consumed while online
- Warn the user when fewer than 30 numbers remain in the block

GST permits multiple invoice series per place of business, but **have the
client's CA confirm the format before go-live**. This is the one thing that
creates a problem for the customer rather than for us. We are not tax
advisors.

### Thermal printing offline

`window.print()` to a thermal printer is unreliable and slow. Generate the
byte stream client-side:

- **Web Serial API** for USB printers (Chrome/Edge desktop)
- **Web Bluetooth** for BT printers
- ESC/POS command bytes generated in `packages/shared`
- Fall back to an HTML print view if neither API is available

Every printer model lies about its spec sheet. **Acquire the exact printer
the first client uses before designing around it.**

### Storage and durability

- Call `navigator.storage.persist()` on first launch — IndexedDB can be
  evicted under storage pressure otherwise
- Cap local retention at ~90 days of transactions; older data is
  server-side only, fetched on demand
- Permanent header badge: **"Offline — 12 bills pending sync"**
- Warn visibly when pending ops exceed ~50
- Version badge in the footer so support can ask "what number does it say?"

### Offline auth — the session split

The front desk is billing at 7pm. Internet has been down three hours. The
JWT expired ninety minutes ago. If the app logs them out mid-bill, the
client is lost.

Two separate concepts:

| | Lifetime | Purpose |
|---|---|---|
| **API access token** | 15 min | Authorises sync calls |
| **Local session** | 12–24 hr, IndexedDB | Authorises use of the app locally |

- The UI checks the **local session**, not the API token
- Local session is device-bound, tenant-scoped, issued at last successful
  online login
- It is **not** invalidated by API token expiry
- On reconnect the worker silently refreshes; if the refresh token is
  genuinely revoked, show a re-login prompt **without discarding a single
  unsynced op**

**Rule: never let a network failure destroy local state.**

### Conflict surfaces

Two screens the owner needs:

1. **Exceptions** — overdrafts, negative stock, permission violations
   detected on sync
2. **Conflicts** — double-booked appointments, competing edits. Accept
   both, show both, let the front desk resolve. Never silently drop one.

---

## 6. Performance & Perceived Speed

The app must feel instant. Not "fast" — instant. The front desk judges the
product on the delay between tapping Save and the receipt printing.

### The rule that makes it instant

**The billing flow must never `await` the network. Not once.**

```
User taps "Save Bill"
  → write to Dexie (IndexedDB)          ~2-5ms
  → write op to outbox                  ~1ms
  → update local balance cache          ~1ms
  → render receipt, push ESC/POS bytes  ~10ms
  → done. Receipt printing.

  [separately, background worker, user never sees it]
  → outbox drains to server when network allows
```

Perceived latency: **under 20ms**. The database could be on another
continent and the front desk would not notice, because the bill was never
waiting on it.

**If a spinner appears during billing, the bug is an awaited write — not a
slow database.** The same applies to customer search, appointment booking,
stock deduction and wallet redemption. All read and write local Dexie first.

### Perceived-speed rules

1. **No spinners on local operations, ever.** A spinner teaches the user
   the app is slow even when it isn't. Local ops complete faster than a
   spinner's fade-in. If you are adding a loading state to something that
   touches only Dexie, delete it.
2. **Maintain a local balance cache.** `SUM()` over a wallet ledger in
   Dexie crawls once a regular customer has ~400 entries. Keep a
   `local_balances` table updated on every ledger write. Server remains
   source of truth; this is a pure read cache, rebuildable from the ledger
   at any time.
3. **App shell precached in the service worker.** Cold start on a 4GB i3
   should paint in under a second — the shell is cached and the data is
   local.
4. **Inline the theme in `index.html` on boot** so there is no colour flash.
5. **Direct ESC/POS bytes, never `window.print()`.** The print dialog is
   the single slowest thing in the flow if you take the browser path.

### Where server latency legitimately shows

Three surfaces, all fixable:

| Surface | Cause | Fix |
|---|---|---|
| First login of the day | API cold start | Cloud Run `min-instances=1` |
| Public booking page (Next.js SSR) | Real server render, real DB hits | Same-region DB, ISR, cached slot availability |
| Reports beyond the 90-day local cache | Genuine remote query | Show local data instantly, stream the rest |

The booking page is the one that matters commercially — it is the page that
converts customers for the client.

### Latency budget

**Sync latency budget is seconds, not milliseconds.** This is the entire
payoff of building offline-first: database latency stops being a UX problem
and becomes an ops metric.

Log p50/p95 separately for:

- `/sync/push` — 400ms p95 is completely fine, nobody waits on it
- `/sync/pull` — same
- Booking page render — this one has a real user waiting; target sub-500ms
- Login — target sub-1s

**Measure before optimising.** A slow booking page is more often query shape
than network hop.

### Database choice: Supabase, Mumbai region

Decided on region, not on benchmarks.

| | Neon | Supabase |
|---|---|---|
| Mumbai region | ❌ Singapore is closest | ✅ `ap-south-1` |
| RTT from Cloud Run `asia-south1` | ~55–80ms | ~3–10ms |
| Idle behaviour | Scale-to-zero, ~100–500ms wake | Always-on (paid); free pauses after 7d idle |
| Free tier | 0.5 GB, 100 projects | 500 MB, 2 projects |
| Paid entry | ~$19/mo | ~$25/mo Pro base + usage |
| Branching | Instant, git-like (genuinely better) | Manual, slower |

Region is fixed at project creation on **both** platforms and cannot be
changed later — moving means a new project and a data migration. Choose
once, correctly.

We roll our own auth, so ~70% of Supabase (auth, realtime, storage,
PostgREST) is ignored. It is used as a managed Postgres with a connection
string. That is a legitimate and intended use.

**Setup:**

- Region `ap-south-1` (Mumbai)
- Connect via **Supavisor in transaction mode**
- **Verify `SET LOCAL app.tenant_id` survives the pooler before Stage 2.**
  This is where the RLS design and the pooler interact. If session state is
  dropped, tenant isolation silently breaks
- One `PrismaClient`, module-scoped, never per request
- Free tier's 2 projects = `dev` and `prod`. Exactly enough
- Do not install the Supabase JS client. Prisma over the pooled connection
  string is all that is needed

**Storage warning:** ledgers are append-only and never delete. A busy salon
posts ~200 ledger rows a day across wallet, stock and sessions. The 500 MB
free tier fills faster than expected. Plan on the ~$25/mo Pro tier arriving
around client #3 and price it into AMC now.

---

## 7. Multi-Tenancy & Security

### Pattern: single database, `tenant_id` on every table, enforced by RLS

Application-layer `WHERE tenant_id = ?` is not sufficient. One forgotten
clause and Salon A sees Salon B's customers. That is a business-ending bug.

Postgres Row-Level Security makes it structurally impossible:

```sql
ALTER TABLE bills ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON bills
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

### Tenant context — AsyncLocalStorage, not request-scoped DI

Nest's `Scope.REQUEST` re-instantiates the whole dependency chain per
request. Slow, and it bites.

```ts
// middleware
als.run({ tenantId, userId, role, terminalId }, () => next());

// anywhere downstream, no plumbing
const { tenantId } = als.getStore();
```

Then inside the transaction wrapper:

```ts
await prisma.$transaction(async (tx) => {
  await tx.$executeRawUnsafe(
    `SET LOCAL app.tenant_id = '${tenantId}'`
  );
  return fn(tx);
});
```

**Verify `SET LOCAL` survives your connection pooler.** PgBouncer in
transaction mode is fine; statement mode is not.

### Repository layer — mostly don't

Prisma **is** the repository. Add a repository class only where queries are
genuinely complex — ledger aggregation, report rollups. Roughly four places.
Blanket repository-over-ORM is how class-based backends become 3,000 lines
of pass-through methods.

---

## 8. Entitlements & Permissions

Two different systems. Conflating them is a real security bug.

| System | Question | Set by | Enforced |
|---|---|---|---|
| **Entitlements** | Does this *salon* have Packages? | Us (sales/plan) | Server, hard |
| **Permissions** | Can this *stylist* void a bill? | Salon owner | Server, hard |
| **Theming** | What colour is the sidebar? | Salon owner | Client, cosmetic |
| **CMS** | What's on their public site? | Salon owner | Content only |

**Hiding UI is not access control.** Both entitlements and permissions must
be checked server-side on every write. Client-side hiding exists only so the
UI isn't confusing.

### Entitlements schema

```sql
CREATE TABLE features (
  key          TEXT PRIMARY KEY,   -- 'packages', 'commissions', 'online_booking'
  label        TEXT,
  category     TEXT,
  depends_on   TEXT[],             -- ['billing']
  default_tier TEXT
);

CREATE TABLE tenant_features (
  tenant_id  UUID,
  key        TEXT REFERENCES features(key),
  enabled    BOOLEAN NOT NULL,
  source     TEXT,                 -- 'plan' | 'override' | 'trial'
  expires_at TIMESTAMPTZ,          -- trials
  PRIMARY KEY (tenant_id, key)
);
```

Resolution order: **plan default → tenant override → trial**. Store the
override separately from the plan so a tier upgrade preserves bespoke
toggles.

**Dependencies must be enforced in the toggle endpoint, not the UI.**
`commissions` needs `billing`. `packages` needs `billing`. `loyalty` needs
`customers`. Turning off a dependency either cascades or is blocked.

### Disabling a feature that holds data

A salon turns off Packages while holding ₹80,000 of unredeemed prepaid
sessions. Hiding the module makes a customer-facing liability silently
disappear.

**Rule: disabling is always read-only, never destructive.**

- Existing packages remain redeemable at billing
- No new packages can be sold
- Reports still show the outstanding liability
- Warn at toggle time with the actual numbers:
  > 12 customers have 47 unused sessions worth ₹80,000. Disabling stops new
  > sales; existing ones stay redeemable.

Add a `disabled_but_has_data` state to the resolver so the POS allows
redemption while hiding the sell button.

### Permissions schema

Role-based with per-user overrides. Never pure per-user ACLs — salon owners
will not configure 40 checkboxes per stylist.

```sql
CREATE TABLE roles (
  id UUID, tenant_id UUID,     -- NULL tenant = system default
  name TEXT,                   -- 'Front Desk', 'Senior Stylist'
  permissions TEXT[],
  is_system BOOLEAN
);

CREATE TABLE user_permission_overrides (
  user_id UUID, permission TEXT, granted BOOLEAN
);
```

Ship four system roles — Owner, Manager, Front Desk, Stylist — that can be
cloned and edited. **Owner is never editable.**

### Permission list

```
bill.create            bill.void              bill.discount
bill.discount.above_10pct                     bill.reprint
customer.view          customer.edit          customer.export
appointment.create     appointment.edit       appointment.cancel
inventory.view         inventory.adjust       inventory.purchase
staff.view             staff.edit             attendance.mark
commission.view_own    commission.view_all
reports.view           reports.financial      reports.export
settings.edit          settings.billing       settings.features
site.edit              site.publish
audit.view
```

Two deliberate splits:

- `commission.view_own` vs `commission.view_all` — a stylist seeing
  colleagues' earnings causes actual fights on the salon floor
- `bill.discount.above_10pct` — front desk discounts a little, manager
  approves anything larger. Most-requested control by owners.

### Enforcement

```ts
@Post('packages')
@RequiresFeature('packages')
@RequiresPermission('package.create')
async create() { ... }
```

**Both decorators are mandatory on every mutating route. Make it a
code-review rule.** Retrofitting guards onto 40 existing endpoints later is
tedious, error-prone, and you will miss some.

### Offline permissions

- Permissions and entitlements ship down in the sync pull, cached signed in
  IndexedDB
- The POS reads them locally so the UI is correct offline
- **The server re-checks every op on sync.** The offline copy is UX
  convenience, never authority
- An op arriving that the user wasn't permitted to make goes to the
  Exceptions tray — not silently dropped
- Changes propagate on next sync. The lag is minutes; the alternative is
  blocking offline work

### Commercial note

Entitlements are not just an off-switch. They are the **pricing mechanism** —
the same table that hides Inventory is what makes plan tiers enforceable and
what lets a 14-day trial of Packages drive an upsell. Build `expires_at` now
even though it won't be used immediately.

---

## 9. Data Model

Core tables, grouped. Every table carries `tenant_id`, `created_at`,
`updated_at`, `row_version`.

### Tenancy & access

```
tenants(id, name, slug, plan, gst_number, address, timezone, status)
locations(id, tenant_id, name, address, is_primary)
users(id, tenant_id, name, phone, email, password_hash, role_id, status)
roles(id, tenant_id, name, permissions[], is_system)
user_permission_overrides(user_id, permission, granted)
terminals(id, tenant_id, location_id, name, last_seen_at)
features(key, label, category, depends_on[], default_tier)
tenant_features(tenant_id, key, enabled, source, expires_at)
audit_log(id, tenant_id, user_id, action, entity, entity_id, before, after, at)
```

### Catalog

```
service_categories(id, tenant_id, name, position)
services(id, tenant_id, category_id, name, duration_min, price,
         tax_rate, commission_rule_id, active)
products(id, tenant_id, name, sku, cost, price, tax_rate,
         reorder_level, active)
packages(id, tenant_id, name, price, validity_days, active)
package_items(package_id, service_id, quantity)
memberships(id, tenant_id, name, price, wallet_credit, benefits JSONB)
```

### People & scheduling

```
customers(id, tenant_id, name, phone, email, dob, anniversary,
          notes, tags[], first_visit_at, last_visit_at)
staff(id, tenant_id, user_id, display_name, skills[], commission_rule_id)
attendance(id, tenant_id, staff_id, date, in_at, out_at, status)
resources(id, tenant_id, location_id, name, type)   -- chairs, rooms
appointments(id, tenant_id, location_id, customer_id, staff_id,
             resource_id, service_id, start_at, end_at, status,
             source, notes)
```

### Money

```
bills(id, tenant_id, location_id, terminal_id, invoice_no, series,
      customer_id, subtotal, discount, tax, total, status,
      created_by, created_at, op_id)
bill_lines(id, bill_id, type, ref_id, name, qty, unit_price,
           discount, tax_rate, staff_id, commission_amount)
payments(id, bill_id, method, amount, reference, status)
expenses(id, tenant_id, category, amount, note, date, created_by)
invoice_leases(tenant_id, terminal_id, series, financial_year,
               block_start, block_end, next_number)
```

### Ledgers (append-only, never updated)

```
wallet_ledger(id, tenant_id, customer_id, delta, reason,
              bill_id, terminal_id, op_id, reverses_id, created_at)
stock_ledger(id, tenant_id, product_id, location_id, delta, reason,
             bill_id, terminal_id, op_id, reverses_id, created_at)
session_ledger(id, tenant_id, customer_id, package_id, service_id,
               delta, bill_id, terminal_id, op_id, reverses_id, created_at)
customer_packages(id, tenant_id, customer_id, package_id,
                  purchased_at, expires_at, bill_id)
```

### Sync

```
processed_ops(op_id, tenant_id, result JSONB, created_at)
tombstones(id, tenant_id, table_name, row_id, deleted_at)
sync_exceptions(id, tenant_id, type, detail JSONB, status, resolved_by)
```

### Site / CMS

```
site_settings(tenant_id, domain, template, theme JSONB,
              seo JSONB, social JSONB, ga_id)
site_sections(id, tenant_id, type, position, enabled,
              data JSONB, published_at)
site_media(id, tenant_id, url, alt, kind)
```

---

## 10. Feature Inventory

**P0** = required to sell · **P1** = required to compete · **P2** = later or never

### Core operations

| Feature | Priority |
|---|---|
| Dashboard — today's revenue, appointments, staff on floor | P0 |
| Customer database, visit history, notes, tags | P0 |
| Appointment book — day/week grid, drag to reschedule | P0 |
| Stylist + resource (chair/room) conflict checking | P0 |
| Service catalog — categories, durations, variable pricing | P0 |
| Products & inventory with reorder alerts | P0 |
| Employees + daily attendance | P0 |
| Recurring appointments | P1 |
| Waitlist | P1 |
| Shift / roster scheduling | P1 |

### Money

| Feature | Priority |
|---|---|
| Billing — services + products, GST, split payment, wallet redeem | P0 |
| Bill history, expense tracking, CSV export | P0 |
| **Commission engine** — flat %, slab, service vs retail, targets | P0 |
| Prepaid packages / session courses | P0 |
| Memberships / wallet | P0 |
| Advances, dues, partial payments | P0 |
| Refunds and bill cancellation (as reversing entries) | P0 |
| Razorpay + UPI QR + payment links | P0 |
| Day-close / cash reconciliation | P0 |
| Gift cards | P1 |
| Loyalty points | P1 |
| Referrals | P1 |
| Tips capture + stylist tip payout | P1 |

### Product infrastructure

| Feature | Priority |
|---|---|
| Multi-tenancy with RLS | P0 |
| RBAC — roles + per-user overrides | P0 |
| Entitlements / feature toggles | P0 |
| Audit log | P0 |
| Onboarding wizard + CSV import | P0 |
| Per-tenant branding, logo, invoice prefix | P0 |
| Theming (colour, dark/light sidebar) | P0 |
| Exceptions + Conflicts screens | P0 |
| Multi-location + roll-up reporting | P1 |
| Subscription billing for our own SaaS | P1 |

### Customer-facing

| Feature | Priority |
|---|---|
| Public salon website (section-based CMS) | P0 |
| Online booking with live slot availability | P0 |
| WhatsApp — booking confirm, 24h reminder, bill PDF, birthday | P0 |
| Customer self-service — packages, wallet, history | P1 |
| Google review request automation | P1 |

### Reporting

| Feature | Priority |
|---|---|
| Date-range reports + CSV export | P0 |
| Revenue per stylist | P0 |
| Chair / staff utilisation | P0 |
| Retail attachment % | P0 |
| Client retention + lapsed-client win-back list | P0 |
| GST summary (GSTR-1 ready export) | P0 |
| Service mix | P1 |
| Peak-hour heatmap | P1 |
| Membership / package liability | P1 |

---

## 11. Theming

Keep this trivial. It is not worth significant engineering time.

Stored on `site_settings.theme`:

```json
{
  "primary": "#8B5CF6",
  "sidebar": "dark",
  "logoUrl": "gs://.../logo.png",
  "radius": "md"
}
```

Implementation:

- CSS custom properties on `:root`, Tailwind mapped to the variables
- Derive the full colour scale from **one** primary using OKLCH
  (`color-mix` or a small helper) — never make the owner pick nine shades

Three guardrails, or expect support calls:

1. **Restrict to 8–12 presets** plus one custom hex field. Free colour
   pickers produce unreadable dashboards.
2. **Enforce contrast.** Compute WCAG AA against text colour; auto-flip
   foreground to white/black on failure. No yellow sidebar with white text.
3. **Cache the theme in IndexedDB and inline it in `index.html` on boot**,
   or every cold start flashes the default colour.

---

## 12. Landing Page CMS

### Do not build a page builder

No drag-and-drop canvas, no free-form blocks. That path consumes months.

### Build a section-based CMS

The owner picks which sections appear, reorders them, fills in fields. Nine
section types cover ~95% of salon sites:

```
hero · services · gallery · team · offers
testimonials · hours · contact · cta
```

```sql
site_sections(
  tenant_id, id,
  type      TEXT,
  position  INT,
  enabled   BOOLEAN,
  data      JSONB,      -- schema per type, validated with zod
  published_at TIMESTAMPTZ
)
```

### The leverage: live data sections

**Services, Team, Hours and Offers pull directly from admin data.** The
owner adds a service to the catalog and it appears on the website. Same
tables, zero extra work, and it is a strong sales line.

### Draft / publish, not live editing

Owner edits a draft → previews → hits Publish. Publish sets `published_at`
and calls Next.js `revalidateTag('tenant-' + id)` for ISR. Prevents a
half-edited hero being live for ten minutes.

### Templates: build one, well

Ship **one** template. Add a second only when a paying client rejects the
first — not before. The same sections, per-tenant colours, per-tenant
photos, and per-tenant copy already make two installs look like different
websites. "Template + your brand + your photos" is what we sell as
customisation.

### Design research workflow (Claude Code)

The template is designed once, from evidence, not from taste. Run this as a
scripted job in Claude Code rather than browsing manually.

**Step 1 — Build the reference list.**

15–25 sites, three buckets:

- Premium Indian salon chains and independents (Mumbai, Delhi, Bangalore)
- International best-in-class salon and spa sites
- Adjacent verticals with the same job-to-be-done: boutique fitness,
  dental, aesthetic clinics. Often better-designed than salon sites

**Step 2 — Capture with Playwright.**

```
scripts/design-research/
  ├── sites.json          # url, name, bucket
  ├── capture.ts          # Playwright: full-page + viewport shots
  └── out/
      ├── desktop/        # 1440×full
      └── mobile/         # 390×full
```

Capture both breakpoints. Salon traffic is majority mobile; a desktop-only
reference set produces a template that fails where it matters.

**Step 3 — Extract a pattern inventory, not pixels.**

Feed the screenshots to Claude Code and produce a structured table:

| Dimension | What to record |
|---|---|
| Section order | What appears first, second, third, and how far the booking CTA sits from the top |
| Hero treatment | Full-bleed photo / video / split / carousel. Headline length |
| Booking entry points | How many, where, sticky or not, WhatsApp vs form |
| Social proof | Position and format of reviews, ratings, press logos |
| Photo-to-text ratio | Salons sell on visuals; most sites under-use photography |
| Typography | Display vs body pairing, size scale, line length |
| Colour usage | How much colour vs neutral, where accent is spent |
| Mobile behaviour | Sticky call/book bar, hamburger contents, tap target sizing |
| Trust signals | Address, hours, phone, map — how prominent |

The deliverable is a **written pattern report**, one page. Convergent
patterns across 20 sites are conventions and should be followed. Divergent
ones are where the design decision lives.

**Step 4 — Synthesize an original design.**

Build the template from the pattern report, not from any single reference.
Then run the design through the same capture script and compare it against
the set — it should read as belonging to the category without resembling
any one member of it.

### Guardrails on the research

Screenshots are for **analysis and internal reference only**. They do not
ship, they are not committed to the repo (`out/` goes in `.gitignore`), and
they are not shown to clients as our work.

Do not copy from any reference site:

- Copy, headlines, taglines, or body text
- Photography, illustration, icons, or video
- Logos, wordmarks, or brand marks
- Distinctive visual expression — a signature layout, a custom illustration
  style, a bespoke motion treatment

Layout conventions are not owned by anyone. "Hero photo, sticky book
button, services grid, testimonials, map footer" is the vocabulary of the
category and is free to use. A specific site's particular execution of it
is not.

Practical test: if a reference site's owner saw our template, would they
recognise it as *a salon site* or as *their salon site*? The first is the
goal. The second is a problem.

All photography on a live client site comes from that client. If they have
none, that is a paid add-on — a photographer, or licensed stock. Never
scraped images, including in demos and pitch decks.

### Per-tenant custom domains

Add via Vercel Domains API; resolve the tenant in Next.js middleware from
`request.headers.get('host')`. Wildcard domains and programmatic domain
management are Pro-tier features.

---

## 13. Build Chronology

Strict dependency order. Do not start a stage before its predecessor's exit
criteria are met.

---

### Stage 0 — Repo and rails

**Goal:** three people can work in parallel without stepping on each other.

- pnpm workspace, `apps/{pos,web,api}`, `packages/shared`
- Shared ESLint / Prettier / tsconfig
- Prisma schema skeleton with `tenant_id` on every table
- CI: typecheck + lint + build on every PR
- `main` always deploys

**Exit:** all three apps boot locally from a single `pnpm install`.

---

### Stage 1 — Foundation

**Build no features in this stage.** If the foundation is wrong, everything
built on it must be rewritten.

- Postgres schema with **ledgers from day one** — no balance columns anywhere
- Row-Level Security policies on every tenant table
- AsyncLocalStorage tenant context + transaction wrapper that sets
  `SET LOCAL app.tenant_id`
- Auth: login, refresh, **local session split** for offline
- **RBAC**: roles table, permission list, `@RequiresPermission` guard
- **Entitlements**: features table, resolver with dependency checks,
  `@RequiresFeature` guard
- Outbox in Dexie, `processed_ops` on server, `OpHandler` registry
- `/sync/push` and `/sync/pull` endpoints
- **One entity end-to-end**: customers. Create offline → outbox → sync →
  RLS-scoped Postgres → pull back to a second device.

**Exit criterion — the gate for the whole project:**
> Create a customer with WiFi off on Device A. Turn WiFi on. The customer
> appears on Device B. Repeat the same op_id twice — no duplicate row.

Do not proceed until this passes.

---

### Stage 2 — Offline billing

The revenue surface. This is what the product is.

- Port the billing screen into the offline model
- Bill + bill_lines as an `OpHandler`
- `StockLedger` and `WalletLedger` wired to billing
- GST calculation in `packages/shared` (used by both POS and reports)
- Split payments, advances, dues
- Refunds and cancellation as **reversing entries**
- Invoice leasing — per-terminal blocks, auto re-lease at 80%
- ESC/POS thermal printing over Web Serial / Web Bluetooth
- Day-close / cash reconciliation
- Offline indicator badge + pending-op count

**Exit criterion:**
> Unplug the router. Create a bill, redeem wallet, deduct stock, print a
> receipt with a final invoice number. Plug back in. Everything syncs, the
> ledgers balance, nothing duplicates.

If this lands, the project will finish.

---

### Stage 3 — Commissions and packages

The two features that close sales.

- Commission engine: flat %, slab, service vs retail split, target bonuses
- Commission rules attached to services and to staff
- `commission.view_own` / `view_all` enforced
- Prepaid packages and session courses on `SessionLedger`
- Package redemption at billing
- Package expiry handling
- Memberships wired to `WalletLedger`
- Audit log populated across all money operations

**Exit:** two stylists on different commission structures bill the same
service and each sees only their own correct number.

---

### Stage 4 — Appointments and reach

- Appointment book with staff + resource conflict checking
- Offline appointment create/edit/cancel
- **Conflicts screen** for double-bookings detected on sync
- Public online booking page (Next.js) with live slot availability
- WhatsApp Cloud API: booking confirmation, 24h reminder, bill PDF,
  birthday message
- WhatsApp sends queued in the outbox, fire on reconnect
- Razorpay payment links / Text2Pay

**Exit:** a customer books online, receives a WhatsApp confirmation, and
the slot is blocked on the POS.

---

### Stage 5 — Reports and ops surfaces

- Revenue per stylist, chair utilisation, retail attachment %
- Client retention and lapsed-client win-back list
- GST summary / GSTR-1 export
- Date-range filtering + CSV on everything
- **Exceptions screen** — overdrafts, negative stock, permission violations
- Onboarding wizard
- CSV import for customers, services, products
- Feature-toggle admin UI with dependency warnings and the
  "12 customers hold 47 sessions worth ₹80,000" confirmation

**Exit:** a new salon can be set up from zero to first bill without a
developer touching the database.

---

### Stage 6 — Presentation layer

- Theming: preset palette, custom hex, contrast enforcement, IndexedDB cache
- **Design research pass** — Playwright capture of 15–25 reference sites,
  pattern inventory, written report. Do this before writing any template
  markup
- Landing page CMS: nine section types, draft/publish, live-data sections
- **One** site template, built from the pattern report
- Per-tenant custom domain wiring
- SEO fields, Google Analytics ID, social links

**Exit:** an owner changes their dashboard colour, edits their hero, hits
publish, and the public site updates.

---

### Stage 7 — Pilot hardening

**No new features in this stage.**

- Migrate the existing POSH client onto the platform
- Run both systems in parallel for a full billing cycle
- Fix only what the pilot surfaces
- Write the runbook: backup, restore, adding a tenant, rotating a lease

**Exit:** the pilot salon runs a full week on the new system with zero
manual database intervention.

---

### Deferred to post-launch

Loyalty points, gift cards, referrals, tips payout, multi-location roll-up,
customer self-service portal, review automation, our own subscription
billing, shift rostering, waitlist, recurring appointments.

None of the first three clients will ask for these before the CMS.

---

## 14. Team Split

Split by **ownership, not by task**. Three people editing the same files
part-time is how projects die.

| Lane | Owns |
|---|---|
| **Lane A** | Sync engine, outbox, ledger model, tenancy + RLS, auth, entitlements, permissions, deployment. The hardest and most dangerous parts — the critical path |
| **Lane B** | Billing, POS, printing, commissions, packages, day-close, refunds. The revenue surface |
| **Lane C** | Appointments, online booking, WhatsApp, reports, CMS, theming. The growth surface |

Working agreement:

- One 45-minute sync per week
- One shared board (Linear or Notion)
- `main` always deploys
- Nest `@Module` boundaries map to lanes — minimal merge conflicts
- **Scope so that P0 survives losing one person for six weeks.** Lane A is
  the critical path; Lanes B and C must be independently shippable.

---

## 15. Infrastructure & Deployment

### Hosting split

| App | Host | Domain |
|---|---|---|
| `apps/web` — Next.js public sites + booking | **Vercel** | client domains |
| `apps/pos` — Vite PWA | **Cloud Run** (same origin as API) | `app.<ours>.com` |
| `apps/api` — NestJS | **Cloud Run**, `asia-south1`, `min-instances=1` | `app.<ours>.com/api` |
| Postgres | **Supabase**, `ap-south-1` (Mumbai), via Supavisor | — |
| Object storage | GCS Standard | — |
| Cron (reminders, reports) | Cloud Scheduler → Cloud Run | — |

### Why POS and API share an origin

Cross-origin POS → API creates two avoidable problems:

- Cookies need `SameSite=None; Secure`, treated harshly by Safari and
  privacy modes
- CORS preflight on every non-simple request — an extra round trip, 200–400ms
  on salon 4G

Same origin removes both. Either one Nest instance with `ServeStaticModule`,
or two Cloud Run services behind one load balancer with path routing.

### Region

Users are in Mumbai. Set Cloud Run to **`asia-south1`**. If any Next.js
route does server work, pin Vercel functions to **`bom1`** — the default is
`iad1` (Virginia) and adds ~250ms per hop for nothing.

### Vercel specifics

- **Hobby tier prohibits commercial use.** Selling to salons requires
  **Pro at $20/month per seat**. Hold one seat; teammates push to branches.
- Root Directory → `apps/web`
- Ignored Build Step so POS/API pushes don't burn build minutes:
  ```bash
  git diff HEAD^ HEAD --quiet -- apps/web packages/shared
  ```
  Exit 0 skips, exit 1 builds.

### Service worker caching

Vercel caches aggressively. A long-cached `sw.js` means terminals run a
stale worker and stop receiving updates — the worst bug class, because you
cannot push a fix to the broken devices.

```json
{
  "headers": [{
    "source": "/sw.js",
    "headers": [
      { "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" }
    ]
  }]
}
```

Same for `manifest.webmanifest`.

### GCP credits

$300 over 90 days ≈ $3.30/day. Cloud SQL alone would consume it.

- Postgres on **Supabase free tier**, not Cloud SQL — Cloud SQL alone would
  consume the entire credit
- Cloud Run **`min-instances=1`** (~$5–8/mo). This is the highest-leverage
  spend available: the API cold start is larger than any database cold
  start, and it is on our side. Fund it from AMC
- Keep-warm ping: Cloud Scheduler → `/health` running `SELECT 1` every
  4 minutes during salon hours (9am–10pm)
- **Set billing budget alerts at $50, $150, $250 on day one.** Trial credits
  expiring silently onto a personal card is a classic and painful mistake

Post-credit steady state: roughly ₹1,500–2,500/month for hosting once
5–10 salons are live. Price this into AMC from client #1.

### Backups

- Supabase free-tier backups are limited — take a nightly `pg_dump` to GCS
  and keep 30 days
- Test a restore before the pilot goes live, not after
- Ledgers are append-only, so a restore loses only unsynced device state —
  another reason the outbox retention window matters

---

## 16. Definition of Done

A feature is not done until all of these hold:

- [ ] Server-side `@RequiresFeature` and `@RequiresPermission` on every
      mutating route
- [ ] Works offline, or degrades with a clear message explaining why not
- [ ] **Never `await`s the network on a user-facing path.** No spinner on
      any operation that touches only Dexie
- [ ] Any running total is a ledger, never a stored balance
- [ ] Every write carries an `op_id` and is idempotent
- [ ] Multi-tenant safe — verified by querying as a second tenant
- [ ] Money-touching paths have a test asserting the ledger balances
- [ ] Errors surface to Exceptions or Conflicts, never silent failure
- [ ] Visible in the audit log if it touches money, stock, or permissions

---

## 17. Known Traps

Ranked by how much damage each does.

1. **Building features before the sync foundation.** Discovering in Stage 4
   that offline billing needs a ledger model means rewriting everything.
   Stage 1 has no features for this reason.

2. **Storing balances instead of ledgers.** The single most expensive
   mistake available. It is unrecoverable without a full data migration and
   it silently loses customer money in the meantime.

3. **Hiding UI and calling it access control.** A stylist opens devtools,
   flips a localStorage flag, and voids a bill. Guards go on the server, on
   every route, from Stage 1.

4. **Missing a `WHERE tenant_id`.** Business-ending. This is why RLS is
   mandatory and not optional.

5. **No idempotency key.** Flaky 4G produces duplicate bills. Duplicate
   bills lose the client.

6. **Thermal printing taking three times the estimate.** Acquire the exact
   printer the pilot client uses before designing around it.

7. **Logging the user out mid-bill when offline.** The local session must
   outlive the API token. Never let a network failure destroy local state.

8. **Stale service worker.** Cache-control on `sw.js`, plus a visible
   version badge for phone support.

9. **A teammate drifting** — exams, internship, life. Lane A is the critical
   path; B and C must be independently shippable so P0 survives.

10. **`await`ing the network on the billing path.** Produces a slow-feeling
    app that gets misdiagnosed as a slow database. The fix is never a
    faster database — it is removing the await.

11. **The pooler silently dropping `SET LOCAL`.** Supavisor in transaction
    mode is fine; statement mode is not. If session state does not survive,
    RLS stops isolating tenants and nothing visibly breaks until a client
    sees another salon's data. Test this explicitly before Stage 2.

12. **Scope creep into AI features.** Every deferred item in this document
    stays deferred until three clients are paying.

---

## Appendix — Reference decisions

| Question | Answer |
|---|---|
| Next.js for the admin dashboard? | No. Server components and server actions cannot run offline. Vite SPA for POS, Next.js for public site only |
| Class-based backend? | Yes. NestJS. Ledgers and the OpHandler registry are where OOP genuinely earns its keep |
| TypeORM or Prisma? | Prisma. Domain logic lives in our classes, so plain-type entities cost nothing |
| Repository layer? | Only for ledger aggregation and report rollups. Prisma is the repository elsewhere |
| Request-scoped DI for tenant context? | No. AsyncLocalStorage |
| npm or pnpm? | pnpm, strict mode. Phantom dependencies are the most common monorepo bug |
| Turborepo? | No. Caching solves a problem three developers don't have |
| Mongo? | No. Ledgers need transactions and `SUM()` |
| SQLite WASM / OPFS for local storage? | No. Dexie over IndexedDB is enough and far less painful |
| Block overdrafts offline? | No. Allow, detect on sync, surface in Exceptions |
| Page builder for the CMS? | No. Fixed section types only |
| How many site templates? | One, built well. A second only when a paying client rejects the first |
| Design the template from taste or evidence? | Evidence. Playwright-capture 15–25 reference sites, extract a pattern report, synthesize an original design from the patterns |
| Copy a competitor's landing page? | No. Layout conventions are free; copy, photography, logos and distinctive visual expression are not. Screenshots are internal reference, gitignored, never shipped |
| Neon or Supabase? | Supabase, `ap-south-1`. Neon has no Mumbai region — Singapore adds ~60ms to every query, and region is unchangeable after creation |
| Use Supabase auth / realtime / storage? | No. We roll our own auth. Supabase is a managed Postgres connection string and nothing else |
| Cloud Run `min-instances`? | 1. The API cold start is bigger than the DB cold start and it is on our side |
| How do we make billing feel instant? | Never `await` the network on a user-facing path. Perceived latency is a Dexie write, not a round trip |