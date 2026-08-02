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
pnpm --filter @salon/api prisma:migrate   # create/apply migrations
pnpm --filter @salon/api rls:apply        # apply row-level security policies
```

`rls:apply` must be re-run after any `migrate reset`, which drops the policies along
with the tables.

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
- **Stage 1 — Foundation.** In progress: RLS, tenant context, auth with the offline
  session split, RBAC, entitlements, the outbox and `OpHandler` registry, and customers
  end-to-end.

Stage 1's exit criterion is the gate for the whole project: create a customer with WiFi
off on device A, turn WiFi on, and it appears on device B — with the same `op_id`
delivered twice producing no duplicate row.

## Licence

Proprietary. All rights reserved.
