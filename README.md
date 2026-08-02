# Solminde Studio SaaS

Offline-first, multi-tenant salon management platform for the Indian market.
One codebase, sold as a bespoke install per salon, each with its own public website.

**The pitch:** salon internet drops. Competitors' web apps stop taking money. This one
does not.

See [SALON_PLATFORM_BUILD_SPEC.md](SALON_PLATFORM_BUILD_SPEC.md) for the architecture,
[PRODUCT.md](PRODUCT.md) for product truth, [DESIGN.md](DESIGN.md) for the visual
system, and [RUNBOOK.md](RUNBOOK.md) for operations.

## Stack

| Layer | Choice | Why |
|---|---|---|
| POS / admin | Vite + React + Dexie (IndexedDB) | Must run with zero server |
| Public sites | Next.js App Router | SSG/ISR, SEO, per-tenant domains |
| API | NestJS + Prisma | DI makes tenant context and transactions tractable |
| Database | Postgres (Supabase, `ap-south-1`) | Ledgers need transactions and `SUM()` |
| Packages | pnpm workspaces, isolated linking | Blocks phantom dependencies structurally |

## Getting started

Requires Node 22.12+ and pnpm 10.

```bash
nvm use              # reads .nvmrc
pnpm install
cp .env.example .env # fill in DATABASE_URL, DIRECT_URL, JWT_SECRET

pnpm dev:pos   # http://localhost:5173  — offline-first POS
pnpm dev:web   # http://localhost:3000  — public sites
pnpm dev:api   # http://localhost:3001  — API
```

Database setup:

```bash
pnpm --filter @salon/api prisma:migrate       # create/apply migrations
pnpm --filter @salon/api create-app-role      # create the NOBYPASSRLS app role
pnpm --filter @salon/api rls:apply            # row-level security policies
pnpm --filter @salon/api sql:apply            # auth lookup functions
pnpm --filter @salon/api db:seed              # two tenants, for isolation tests
pnpm --filter @salon/api verify:isolation     # prove isolation actually holds
```

`rls:apply` must be re-run after any `migrate reset`, which drops the policies along
with the tables.

**The application must not connect as `postgres`.** Supabase's default role has
`rolbypassrls = true`, which skips every RLS policy — including tables marked FORCE ROW
LEVEL SECURITY — and nothing visibly breaks until one salon sees another salon's data.
`create-app-role` provisions `salon_app` (NOBYPASSRLS, owns nothing) for `DATABASE_URL`;
`DIRECT_URL` stays as `postgres` for migrations and DDL only. `verify:isolation` fails
the build if this ever regresses.

## Testing

```bash
pnpm test:unit   # node:test — GST/bill maths, wallet, commissions, CSV, theme contrast
pnpm test:api    # Bruno — auth, isolation, billing, booking, reports, site CMS
pnpm test:e2e    # Playwright — the Stage 1–6 gates (needs the web + api dev servers)
pnpm test        # all three
```

## Two rules that govern everything

**1. Never store a running total.** Wallet balance, stock on hand and package sessions
are `SUM(delta)` over append-only ledgers. Offline merging becomes addition, and
addition commutes — two devices syncing in any order reach the same number. Entries are
immutable; a mistake is corrected by a reversing entry, never an `UPDATE` or `DELETE`.

CI fails the build if a balance column appears in the schema.

**2. Never `await` the network on a user-facing path.** The billing flow writes to Dexie,
writes an op to the outbox, and renders the receipt. A background worker syncs later. If
a spinner appears during billing, the bug is an awaited write — not a slow database.

## Repository layout

```
apps/
  pos/       Vite + React PWA — offline-first admin and billing
  web/       Next.js — public salon sites and online booking
  api/       NestJS + Prisma — all server logic
packages/
  shared/    money/GST maths, ledger rules, sync schemas, permissions
```

## Build status

- **Stage 0 — Repo and rails.** Complete. All three apps boot from one `pnpm install`.
- **Stage 1 — Foundation.** Complete and verified against Supabase (`ap-south-1`). RLS
  enforced on 35 tables, tenant context via AsyncLocalStorage, auth with the offline
  session split, RBAC, entitlements with dependency checks, the Dexie outbox, the
  `OpHandler` registry, and customers end-to-end.

  **Gate passed:** a customer created with WiFi off on device A appears on device B after
  reconnect, and the same `op_id` delivered twice produces no duplicate row.

- **Stage 2 — Offline billing.** Complete and verified against Supabase. Bills
  and voids as `OpHandler`s, GST computed once in `packages/shared` and shared by
  POS and API, `StockLedger` and `WalletLedger` wired to billing, split payments
  with advances and dues on the wallet ledger, refunds and cancellation as
  reversing entries, per-terminal invoice leasing (advisory-locked, auto re-lease
  at 80%), ESC/POS thermal printing over Web Serial with an HTML fallback, and
  per-terminal day-close cash reconciliation.

  **Gate passed:** with the network offline, a bill redeems wallet, deducts
  stock and prints a final invoice number; on reconnect everything syncs, the
  ledgers balance exactly, and a replayed op creates no duplicate and no double
  charge.

- **Stage 3 — Commissions and packages.** Complete and verified against Supabase.
  Commission engine (flat, service-vs-retail split, slabs, target bonus) shared
  by POS and API, per-line commission snapshotted at bill time and rolled up at
  read time, `commission.view_own` / `view_all` enforced server-side, prepaid
  packages and session courses on the `SessionLedger` with redemption at billing
  and expiry surfaced as exceptions, memberships wired to the `WalletLedger`, and
  the audit log populated across every money operation.

  **Gate passed:** two stylists on different commission structures bill the same
  service offline; on sync each earns the correct, separate number, and a stylist
  logging in sees only their own — never a colleague's.

- **Stage 4 — Appointments and reach.** Complete and verified against Supabase.
  Appointment book with staff + resource (chair) conflict checking, offline
  book/cancel via the outbox, double-bookings detected on sync and surfaced as
  `appointment_conflict` (accept both, never drop one), a public Next.js booking
  page with live slot availability (resolved by tenant slug, no login), WhatsApp
  and Razorpay behind provider interfaces (stubbed — no credentials needed),
  WhatsApp sends queued in the outbox, and Text2Pay payment links.

  **Gate passed:** a customer books online, a confirmation message is dispatched,
  the slot stops being offered, and the booking is pulled down onto the front
  desk's POS appointment book.

- **Stage 5 — Reports and ops surfaces.** Complete and verified against Supabase.
  Revenue per stylist, GST/GSTR-1 summary, chair utilisation, retail attachment,
  client retention + lapsed win-back — all pure read-side aggregation over the
  ledgers, with CSV export (`?format=csv`) on the money reports. Exceptions and
  Conflicts trays with resolve, feature-toggle admin with server-enforced
  dependencies and the package-liability confirmation, and CSV import for
  customers, services and products.

  **Gate passed:** a service imported from CSV through the admin API flows down
  to the POS catalogue on sync and is billed — a salon set up from zero to first
  bill without a developer touching the database.

- **Stage 6 — Presentation layer.** Complete and verified against Supabase.
  Per-tenant theming with server-enforced WCAG contrast (accent auto-flips its
  text), a design-research pass (Playwright capture of 15 reference sites + a
  written pattern report; screenshots gitignored), the section-based landing CMS
  (nine section types, draft→publish via `publishedAt` + ISR, live-data sections
  pulling services/team from admin data), one Next.js site template built from
  the pattern report, and per-tenant custom-domain resolution (host→slug in a
  Next `proxy`, backed by a `SECURITY DEFINER` lookup).

  **Gate passed:** an owner changes their accent colour, edits their hero and
  hits publish — and the live public site updates.

- **Stage 7 — Pilot hardening.** In progress. No new features: the operations
  [RUNBOOK.md](RUNBOOK.md) is written (backup/restore, onboarding a salon,
  rotating an invoice lease, deploy, keep-warm/monitoring, the pilot
  parallel-run + cutover checklist, and an incident quick reference). The
  remaining work — migrating the live pilot client and running both systems in
  parallel — happens against real client data and production infrastructure.

## Licence

Proprietary. All rights reserved.
