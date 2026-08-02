# Operations Runbook

The procedures for running the platform in production: backup and restore,
onboarding a salon, rotating an invoice lease, deploying, and handling the
incidents this system is prone to. Written for Stage 7 (pilot hardening).

Two rules govern everything an operator does:

1. **The application must never connect as `postgres`.** It connects as
   `salon_app` (NOBYPASSRLS), or tenant isolation silently stops working.
2. **Ledgers are append-only.** Never `UPDATE`/`DELETE` a ledger row to "fix" a
   number — post a reversing entry. A restore therefore only ever loses unsynced
   device state, never settled history.

Environment: Supabase Postgres in `ap-south-1` via Supavisor (transaction mode),
API + POS on Cloud Run `asia-south1`, public sites on Vercel (`bom1`), object
storage on GCS. Region is fixed at project creation and cannot be changed.

---

## 1. First-time database setup

Run once per environment (dev, prod), in this order. Commands are the repo's own
scripts; `DATABASE_URL` is the pooled `salon_app` connection, `DIRECT_URL` the
unpooled `postgres` connection used only for DDL.

```bash
pnpm --filter @salon/api create-app-role      # provision salon_app (NOBYPASSRLS)
pnpm --filter @salon/api prisma:migrate        # apply migrations (DIRECT_URL)
pnpm --filter @salon/api rls:apply             # row-level security policies
pnpm --filter @salon/api sql:apply             # SECURITY DEFINER auth/public fns
pnpm --filter @salon/api verify:isolation      # PROVE isolation holds — must pass
```

`verify:isolation` is the gate. It fails the setup if `salon_app` can bypass RLS,
if any tenant table is not `FORCE ROW LEVEL SECURITY`, if a query with no tenant
context returns rows, or if `SET LOCAL app.tenant_id` leaks past its transaction
(the Supavisor **transaction-mode** check). Do not deploy if it fails.

**`rls:apply` and `sql:apply` must be re-run after every `prisma migrate`** — a
migration can recreate a table without its policies. Make it part of the deploy
(see §5).

---

## 2. Backup

Supabase free-tier backups are limited, so take an independent nightly dump to
GCS and keep 30 days. Ledgers never delete, so backups only grow slowly.

```bash
# Nightly, via Cloud Scheduler → a small Cloud Run job (uses DIRECT_URL).
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
pg_dump "$DIRECT_URL" --format=custom --no-owner --file="/tmp/salon-$STAMP.dump"
gzip "/tmp/salon-$STAMP.dump"
gsutil cp "/tmp/salon-$STAMP.dump.gz" "gs://<backup-bucket>/db/salon-$STAMP.dump.gz"

# Retention: delete dumps older than 30 days.
gsutil ls "gs://<backup-bucket>/db/" | while read -r f; do
  age=$(( ( $(date -u +%s) - $(date -u -d "$(gsutil stat "$f" | awk '/Creation time/{ $1=$2=""; print }')" +%s) ) / 86400 ))
  [ "$age" -gt 30 ] && gsutil rm "$f"
done
```

Prefer setting a **GCS lifecycle rule** (delete after 30 days) over the loop
above; it is one config and cannot be skipped by a failed cron. Set a bucket
lock/versioning so a compromised key cannot wipe history.

**Test a restore before the pilot goes live, not after** (§3). An untested
backup is not a backup.

---

## 3. Restore

Restore into a **fresh** database (a new Supabase project or a scratch schema),
verify, then cut over — never restore over a live database first.

```bash
gsutil cp "gs://<backup-bucket>/db/salon-<STAMP>.dump.gz" /tmp/
gunzip /tmp/salon-<STAMP>.dump.gz
pg_restore --clean --if-exists --no-owner --dbname="$RESTORE_DIRECT_URL" /tmp/salon-<STAMP>.dump

# Re-provision the app role + policies + functions on the restored DB, then PROVE it.
pnpm --filter @salon/api create-app-role
pnpm --filter @salon/api rls:apply
pnpm --filter @salon/api sql:apply
pnpm --filter @salon/api verify:isolation      # must pass before pointing traffic here
```

What a restore loses: only **unsynced device state** — bills/appointments still
sitting in a terminal's Dexie outbox that had not reached the server. Because the
outbox retains ops until acked, reconnecting those terminals re-drains them and
the ledgers reconcile (idempotency on `op_id` means replays create no
duplicates). This is why the outbox retention window matters — keep it ≥ the
longest expected offline stretch.

---

## 4. Onboarding a salon (adding a tenant)

Done from the product, not the database — this is the Stage 5 promise. There is
no raw SQL step.

1. **Create the tenant + owner** (one-time, via the seed pattern or an admin
   script): a `tenants` row, an Owner `Role` (all permissions, `isSystem`), an
   Owner `User`, and `tenant_features` rows for the plan. Tenant ids are
   generated app-side because the RLS policy needs the id known before insert.
2. **Enable/disable features** for the plan in the POS **Setup** tab
   (`/admin/features`) — dependencies are enforced server-side.
3. **Import the catalogue and customers** in **Setup → Onboarding import**: CSV
   for customers (`name,phone,email,notes`), services
   (`name,durationMin,price,taxRate`), products
   (`name,sku,cost,price,taxRate`). Prices are rupees; bad rows are skipped, not
   fatal; customers upsert on phone.
4. **Opening stock**: post an opening `stock_ledger` entry per product (a stock
   adjustment), never a stored count.
5. **Invoice series**: confirm the series format with the client's CA, then let
   each terminal lease its first block on first online use (`POST /billing/lease`).
6. **Site**: pick an accent and sections in the POS **Site** tab, Publish.
   Point a custom domain (§ per-tenant domains) if the client has one.

Verify: log in as the owner, ring up one test bill offline, reconnect, confirm it
syncs and the ledgers balance.

---

## 5. Deploy

`main` always deploys. Order matters because migrations and policies interact.

```bash
# 1. Migrate + re-apply policies/functions (DIRECT_URL). ALWAYS re-apply RLS.
pnpm --filter @salon/api prisma:migrate
pnpm --filter @salon/api rls:apply
pnpm --filter @salon/api sql:apply
pnpm --filter @salon/api verify:isolation      # abort the deploy if this fails

# 2. API + POS → Cloud Run (asia-south1, min-instances=1, same origin).
# 3. Public sites → Vercel (Root Directory apps/web; functions pinned to bom1).
```

Cloud Run: `min-instances=1` (the API cold start is bigger than the DB's and it
is on our side). Same origin for POS and API (avoids `SameSite=None` cookies and
CORS preflight on salon 4G). Vercel: Pro tier (Hobby prohibits commercial use);
Ignored Build Step so POS/API pushes don't burn build minutes.

**Service worker cache-control is mandatory.** `sw.js` and
`manifest.webmanifest` must be served `Cache-Control: public, max-age=0,
must-revalidate`, or terminals pin a stale worker and stop receiving updates —
the worst bug class, because you cannot push a fix to the broken devices. A
visible version badge in the POS footer lets phone support ask "what number does
it say?".

Publish → live sites: the API's `SiteRevalidator` calls the web app's
`/api/revalidate` (set `WEB_REVALIDATE_URL` + `WEB_REVALIDATE_SECRET`); without
it the site still refreshes on its 5-minute ISR window.

---

## 6. Keep-warm, monitoring, budget

- **Keep-warm:** Cloud Scheduler → `GET /api/health` every 4 minutes during
  salon hours (09:00–22:00). `/health` runs `SELECT 1`, so it also alarms if the
  DB connection dies.
- **Latency:** log p50/p95 for `/sync/push`, `/sync/pull` (seconds are fine —
  nobody waits on them), the booking page render (real user waiting; target
  sub-500ms), and login (target sub-1s).
- **Budget alerts:** set GCP budget alerts at **$50, $150, $250 on day one**.
  Trial credits expiring silently onto a personal card is the classic painful
  mistake. Plan for the ~$25/mo Supabase Pro tier around client #3 (ledgers are
  append-only and the 500 MB free tier fills).

---

## 7. Rotating an invoice lease

Invoice numbers are pre-leased in per-terminal blocks so a printed number is
final offline. Normal operation re-leases automatically at 80% consumed. Operator
action is only needed in these cases:

- **A terminal is retired / reset.** Its remaining leased block is simply
  abandoned — numbers are per-terminal and disjoint, so gaps are expected and
  harmless (GST permits non-contiguous series). Do **not** reissue its block to
  another terminal; that would risk a collision.
- **A new financial year (April).** `financialYear` rolls over automatically and
  the next lease request opens a fresh series (`.../26-27/...` → `.../27-28/...`).
  No action needed; confirm with the client's CA that the new-year format is what
  they expect before the first April bill.
- **"Fewer than 30 numbers left" warning offline.** Get that terminal online
  briefly so it can lease the next block; it re-leases automatically once it can
  reach `POST /billing/lease`. Until then it can keep billing on the remaining
  numbers.
- **Forcing a re-lease** (e.g. a series change mid-year, CA-approved): while
  online, call `POST /billing/lease` for the terminal with the new `series`; the
  advisory-locked high-water mark guarantees a non-overlapping block.

Never edit `invoice_leases` or a bill's `invoiceNo` by hand — a duplicate or
altered invoice number corrupts the GST filing.

---

## 8. Pilot: parallel run and cutover

1. **Restore-test first** (§3) — prove the backup before any real data is on the
   system.
2. **Onboard the pilot salon** (§4) with real catalogue + customers.
3. **Parallel run** for one full billing cycle: bills are entered in both the old
   system and the new one. Reconcile daily — day-close cash variance and the
   ledger totals must match the old system's day sheet.
4. **Watch the exception and conflict trays** (POS Setup): overdrafts, negative
   stock, permission violations, double-bookings. Each should be understood, not
   just cleared.
5. **Cut over** only after a clean cycle: the new system becomes the source of
   truth, the old one goes read-only for reference.
6. **Exit criterion:** the pilot runs a full week with **zero manual database
   intervention**. If an operator had to touch SQL, that is a product bug to fix,
   not a procedure to document.

---

## 9. Incident quick reference

| Symptom | First check |
|---|---|
| A salon sees another salon's data | STOP. `verify:isolation`. Confirm the app connects as `salon_app` (not `postgres`) and Supavisor is in **transaction** mode. This is business-ending — take the app offline until isolation is proven. |
| Billing shows a spinner / feels slow | An `await` crept onto a user-facing path. Billing writes Dexie + outbox only; it must never await the network. Not a slow database. |
| Duplicate bill after a flaky sync | Should be impossible — `processed_ops` dedupes on `op_id`. If it happened, a write path skipped the outbox/idempotency. |
| Terminals stopped updating | Stale service worker. Verify `sw.js` cache-control (§5). Ask support for the footer version number. |
| Front desk logged out mid-bill offline | The local session (12–24h, IndexedDB) must outlive the 15-min API token. A network failure must never destroy local state. |
| Wallet/stock/sessions went negative | Expected and allowed offline — it is on the Exceptions tray. Resolve there (adjust / write off); never edit the ledger. |
| Login slow first thing in the morning | Cloud Run cold start. Confirm `min-instances=1` and the keep-warm ping (§6). |
| Public site not updating after Publish | `WEB_REVALIDATE_URL`/secret unset or the webhook failed; the site still refreshes within the 5-min ISR window. |
