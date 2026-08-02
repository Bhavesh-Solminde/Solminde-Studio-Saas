# Solminde Studio SaaS

Offline-first, multi-tenant salon management platform for the Indian market.
One codebase, sold as a bespoke install per salon, each with its own public website.

**The pitch:** salon internet drops. Competitors' web apps stop taking money. This one
does not.

See [SALON_PLATFORM_BUILD_SPEC.md](SALON_PLATFORM_BUILD_SPEC.md) for the architecture,
[PRODUCT.md](PRODUCT.md) for product truth, and [DESIGN.md](DESIGN.md) for the visual
system.

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
pnpm test:unit   # node:test — GST/bill maths, wallet settlement, invoice numbering
pnpm test:api    # Bruno — auth, sync, idempotency, tenant isolation, billing, void
pnpm test:e2e    # Playwright — the Stage 1 and Stage 2 offline gates
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

- **Stage 3 — Commissions and packages.** Next.

## Licence

Proprietary. All rights reserved.
