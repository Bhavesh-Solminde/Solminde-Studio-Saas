# Problems

Critical architectural decisions, hard logic, trade-offs and blockers — and how
each was resolved. Not a changelog: trivial bugs, syntax, formatting and routine
debugging are deliberately excluded.

Stages 0–1 predate this file; their decisions are documented in
`SALON_PLATFORM_BUILD_SPEC.md` and the commit history. This log starts at
Stage 2.

---

## Stage 2 — Offline billing

### Dues and advances live on the wallet ledger, not a separate table

**Decision.** A partial payment (a due) and an over-tender (an advance) are both
recorded as entries on `wallet_ledger`: a due is a negative delta, an advance a
positive one. The customer's net position is `SUM(delta)` — positive means they
hold credit, negative means they owe.

**Why.** The data model has no dues table, and adding one would mean a second
running total to reconcile offline. Folding both into the wallet ledger keeps
one append-only ledger whose sum commutes across terminals like every other
balance in the system, so two offline devices reach the same number regardless
of sync order.

**Trade-off.** "Wallet credit" and "outstanding due" are the same column with
opposite signs, so a report that wants them separated must split on sign rather
than read two fields. Accepted: the commutativity guarantee is worth more than
the reporting convenience, and the `reason` on each entry (`redeem`/`advance`/
`due`) still distinguishes them.

### Invoice-lease blocks: advisory lock, not the table PK

**Blocker.** Invoice numbers are leased in per-terminal blocks so the printed
number is final offline. The obvious guard against overlap — the lease table's
primary key — does **not** work: the PK includes `terminalId`, so two terminals
computing the same next `blockStart` at the same moment both insert
successfully and hand out the *same* range. Two customers then walk out with the
same invoice number and the client's GST filing is corrupt.

**Solution.** Serialise lease requests on the `(tenant, series, financialYear)`
key with `pg_advisory_xact_lock(hashtext(...))` before reading `MAX(blockEnd)`.
The lock is transaction-scoped and releases on commit, so concurrent leases for
the same series queue and each sees the true high-water mark. Different series
never contend.

### The server recomputes bill totals; the device's total is display-only

**Decision.** `bill.create` recomputes `subtotal`/`discount`/`tax`/`total`
server-side from the same `computeBill` in `packages/shared` that the device
used, and stores the recomputed figures. The invoice number, by contrast, is
trusted from the device (it is already printed).

**Why.** The receipt total must be final at print time, but the ledger must be
authoritative. Because both sides run identical shared code they always agree,
so this is not an override — it is a guarantee that a malformed or tampered
payload cannot post a bill whose stored total disagrees with its lines. This is
the concrete enforcement of "money must never be wrong."

### `OpHandler.apply` gained an `OpMeta` (opId, terminalId)

**Decision.** The handler signature is now
`apply(tx, ctx, payload, op: OpMeta)`. Bills and every ledger entry stamp the
originating op's `opId` and `terminalId`.

**Why.** A ledger row's `opId` is both its idempotency link and what a reversing
entry points back at; `terminalId` is needed for per-terminal cash
reconciliation. Neither can come from the JWT — an offline op may have been
created on a terminal hours before it syncs, under a token that has since
expired and been reissued. It has to travel with the op. The existing customer
handler simply ignores the new argument, so nothing else changed.

### Overdrafts are surfaced, but only a redemption is flagged

**Logic.** Posting a wallet redemption or a stock sale can drive a balance
negative. Per spec this is allowed (it cannot be prevented offline) and surfaced
on the Exceptions screen rather than blocked. The subtlety: a *due* also makes
the wallet balance negative, but that is expected and correct, not an overdraft.
So the negative-balance check runs only after a `redeem` effect, never after a
`due`. Getting this wrong would file every partial payment as an exception.

### `day_closes`: a snapshot, and expenses deferred

**Decision.** Added a `day_closes` table for cash reconciliation. Expected cash
is derived (`SUM` of the day's cash payments on final bills); counted cash is a
physical count stored as a point-in-time snapshot, which breaks no ledger rule.
Cash *expenses* are deliberately not subtracted yet — the expenses surface does
not exist until a later stage, and until then the variance line absorbs them.

**Trade-off.** A salon that pays cash expenses out of the drawer will see a
negative variance that is not skimming. Documented in the handler; acceptable
because the alternative is building the expenses surface early, out of stage
order.

### Blocker: `bru --cwd` removed in Bruno CLI v4

The `test:api` script ran `bru run --env local --cwd tests/bruno`; `--cwd` was
dropped in the v4 CLI and the command errored out before running anything.
Changed to `cd tests/bruno && bru run --env local`. Not a Stage 2 concern in
itself, but it silently disabled the entire API test suite and had to be fixed
to verify the stage.

### Unresolved / deferred

- **Local stock cache starts empty on a device.** Opening stock is a server-side
  ledger entry; a fresh device's local `stock` balance cache reads 0 until a
  rebuild-from-ledger path exists. The cache is explicitly rebuildable and the
  server remains authoritative, so this is a display gap, not a correctness one.
  A pull of stock balances (or a rebuild on login) lands with the reports stage.
- **Web Bluetooth printing is not implemented.** Web Serial and an HTML fallback
  are; BT printers fall through to HTML. Per spec, the exact pilot printer must
  be acquired before finishing the transport, so this waits for hardware.

---

## Stage 3 — Commissions and packages

### Commission is two layers: a per-line snapshot and a read-time rollup

**Decision.** Per-line commission (flat percentage, service-vs-retail split) is
computed at bill time and snapshotted onto `bill_lines.commissionAmount`. Slab
and target-bonus amounts, which depend on a whole period's revenue, are NOT
snapshotted — they are derived at read time in the commission summary.

**Why.** Two forces pull in opposite directions. The spec says a stylist's
earned commission is "derived from bill lines at read time," but it also says
`bill_lines.commissionAmount` is "snapshotted so a later rule change cannot
retroactively alter what a stylist already earned." Both are right, for
different parts of the calculation: a flat rate is knowable per line and must be
frozen, but a slab rate is unknowable until the period is totalled and can only
be computed on read. Splitting the calculation is what satisfies both.

**Consequence.** For a flat rule the summary's base is the *sum of snapshots*
(authoritative). For a slab rule it is *recomputed* from period net revenue.
Mixing the two in one summary means the code branches on `rule.kind`, which is
the price of getting both invariants right.

### `view_own` vs `view_all` is an OR the permission guard cannot express

**Blocker.** A commission summary must be reachable by a stylist with
`commission.view_own` OR a manager with `commission.view_all`. The
`@RequiresPermission` guard takes exactly one permission and ANDs it, so it
cannot encode "either of these two." Requiring the weaker one would lock out a
manager who holds only the stronger one, and vice versa.

**Solution.** Gate the route on the feature (`@RequiresFeature('commissions')`)
and resolve the two permissions inside the handler: reject if the user has
neither, scope to the caller's own staff record if they have only `view_own`.
The scoping is what enforces privacy — a view-own request never even computes
another stylist's number, so it cannot leak. This keeps the general guard simple
rather than teaching it about OR semantics for one route.

### Commission is taken on the net, ex-GST value

**Decision.** The commission base is a line's taxable value (unit price ×
quantity − discount), not its GST-inclusive total. The salon does not pay a
stylist commission on tax it is merely collecting on the government's behalf.
Documented here because it is a business rule that is invisible in the code —
`line.taxable` looks like an arbitrary field choice without this reason.

### Package redemption failures are surfaced, not blocked

**Decision.** Redeeming a package session that has run out (negative remaining)
or belongs to an expired package is allowed through and recorded as a sync
exception (`negative_sessions` / `expired_package`), never blocked at billing.

**Why.** This is the same reasoning as an overdraft: an offline terminal cannot
always know the true remaining count or the current date-vs-expiry, and stopping
the front desk mid-bill is worse than letting a rare exception through for the
owner to resolve. Consistency with the wallet/stock overdraft handling keeps one
mental model for "the ledger went somewhere it shouldn't have."

### Audit rows are written on the money op's own transaction

**Decision.** `AuditService.record` writes on the same `tx` as the change it
describes, inside the handler. A committed bill and its audit row are therefore
atomic — there is no interleaving where one exists without the other, and a
rolled-back op leaves no orphan audit entry.

### Deferred

- **Membership benefits beyond the wallet credit.** A membership currently only
  posts its `walletCredit`; the `benefits` JSON (discounts, priority booking) is
  not interpreted yet. Out of scope until a client actually sells one.
- **Commission-rule resolution re-queries per line.** `resolveRule` does its own
  lookups for each line rather than batching by distinct staff. Bills carry a
  handful of lines, so this is not worth the caching complexity yet; revisit if
  a bulk-import path ever recomputes commission over thousands of lines.

---

## Stage 4 — Appointments and reach

### Conflicts are detected, not prevented, and reuse the exceptions table

**Decision.** A double-booking (same stylist or same chair, overlapping time) is
allowed through — both appointments are created — and the overlap is recorded as
a `sync_exception` of type `appointment_conflict`. The spec's Conflicts screen
is that table filtered by type, not a separate table.

**Why.** In an offline model neither the POS nor the online booking page can
guarantee it saw the other's booking first, so a race is genuinely possible and
cannot be prevented without a round trip. "Accept both, show both, let the front
desk resolve" is the spec's rule, and it is also the only correct behaviour when
you cannot know which booking is "first". Reusing `sync_exceptions` keeps one
surface and one mental model for "something needs a human"; the type column is
enough to split Exceptions (money/stock) from Conflicts (bookings) in the UI.

### The public booking API is unauthenticated — resolved by a definer function

**Blocker.** The online booking page has no login, but it must read a salon's
services and take a booking. RLS fails closed, so an ordinary query returns
nothing — the same problem login has.

**Solution.** Same fix as login: a narrow `SECURITY DEFINER` function
(`app_public_tenant`) resolves the slug to a tenant id and a few non-sensitive
fields, and the `/api/public/*` routes are exempted from the bearer check in the
tenant middleware. Everything after resolution runs inside that tenant's RLS
scope via `tenantStorage.run`, with an empty user id (there is no user).

### Availability means "a free chair", read once and computed in memory

**Decision.** A slot is offered when business hours contain it, the requested
stylist (if any) is free, and at least one resource (chair) is free. An online
booking with no chosen stylist is auto-assigned the first free chair, so
capacity is the number of resources.

**Why the shape matters.** The availability endpoint is the booking page's
render path — commercially the page that converts customers, with a real user
waiting and a sub-500ms target. The first implementation queried per slot per
resource (~40 round trips for a day); it now reads the day's bookings and the
resource list ONCE and runs the slot loop in memory (2 queries). A booking-page
render must never fan out into a query per slot.

**Trade-off.** Business hours are a single constant window and dates are treated
as a UTC day. A per-staff roster (P1) and timezone-correct local days are
deferred — noted below — because getting the offline booking loop and the
capacity model right first is what the gate depends on.

### Messaging and payments are behind interfaces, stubbed

**Decision.** `MessagingProvider` (WhatsApp) and `PaymentProvider` (Razorpay)
are interfaces; development binds stub implementations that need no credentials.
Going live is swapping the binding in the module — no handler, controller or
test changes. Approved with the user before building (Stage 4 kickoff).

**One real caveat.** The stub dispatches synchronously inside the caller's
transaction, which is fine because it does no I/O. A live provider does real
network I/O and must NOT run inside a database transaction; its dispatch has to
move to a post-commit worker draining `messages` where status = 'queued'. The
queue-first design already supports that — the worker is simply not built yet.

### Deferred

- **Live WhatsApp / Razorpay wiring** and the **post-commit dispatch worker** —
  waiting on credentials and a provider decision (see above).
- **Timezone-correct business hours and a per-staff roster.** Availability uses
  a fixed UTC open/close window; real salons need local-day hours and per-stylist
  shifts. Lands with the scheduling surface.

---

## Stage 5 — Reports and ops surfaces

### Reports are pure read-side derivation — no new source of truth

**Decision.** Every report (revenue per stylist, GST, retention, chair
utilisation, retail attachment, package liability) is computed at query time
from the bills and ledgers earlier stages already wrote. Nothing is stored as a
precomputed total.

**Why.** It is the same discipline as SUM(delta) balances: a figure recomputed
from what happened cannot drift from what happened. In particular the GST
summary recomputes the CGST/SGST split from bill lines with the *same shared
`splitGst`* used at bill time, so a GSTR-1 export can never disagree with what
was actually charged on the printed invoices.

### "Last visit" is derived from bills, not a stored column

**Decision.** The lapsed-client win-back list derives each customer's last visit
from the most recent bill (`MAX(createdAt)` per customer), rather than reading a
`customers.lastVisitAt` column.

**Why.** A stored `lastVisitAt` would have to be updated on every bill — one more
write to keep in sync, and a source of drift if a bill is created offline or
voided. Deriving it from bills means retention can never disagree with billing
history. The schema's `lastVisitAt` stays unused for now; wiring it as a cache
(like `local_balances`) is a later optimisation, not a correctness need.

### Disabling a feature is non-destructive — structurally, not by a flag

**Decision.** Disabling Packages stops new package sales but leaves existing
prepaid sessions redeemable, with no special "disabled-but-has-data" resolver
state.

**Why it falls out for free.** Selling a package is the `package.purchase` op,
which requires the `packages` feature — disabling the feature blocks it.
Redeeming a session is a line inside `bill.create`, which requires only
`billing` — so redemption keeps working regardless of the `packages` toggle.
The spec's "disabling is read-only, never destructive" is therefore enforced by
where each capability's feature gate sits, not by a stateful resolver. The admin
UI still shows the outstanding liability (customers × sessions × per-session
value) before the owner confirms, so the decision is informed.

### Blocker: CI typechecked before it built `@salon/shared`

**What happened.** CI ran `pnpm typecheck` before `pnpm build`, so
`packages/shared/dist` did not exist yet and `apps/pos`/`apps/web` failed with
"Cannot find module '@salon/shared'" — every other type error in the run
cascaded from that one missing module. It passed locally only because a previous
build had left `dist` in place. Latent since Stage 1; surfaced when Stage 4's
branch CI ran.

**Fix.** Two ways, so it cannot recur: the root `typecheck` script builds shared
first, and `@salon/shared` gained a `prepare` script so `pnpm install` always
produces `dist` (fresh clones and CI included). Verified by deleting `dist` and
reproducing CI's exact sequence.

### Deferred

- **`customers.lastVisitAt` as a maintained cache** — derived on read for now.
- **Peak-hour heatmap, service mix, membership/package liability trends** (P1
  reports) — the aggregation primitives exist; these are additional shapes.

---

## Stage 6 — Presentation layer

### The template is designed from evidence, then thrown away the evidence

**Decision.** Ran the spec's design-research pass: `scripts/design-research/`
Playwright-captures 15 reference sites (Indian salons, international salon/spa,
adjacent verticals) at desktop and mobile, and a one-page **pattern report**
records the conventions. The one template is built from that report plus
`DESIGN.md` — never from any single site.

**Guardrail, enforced by structure.** Screenshots are analysis-only: `out/` is
gitignored, so they cannot be committed or shipped. The committed artefacts are
the harness, the site list and the written report. No copy, photography, logo or
distinctive expression is reused — only category conventions, which are free.

### Draft/publish is `publishedAt` + ISR, not a second data column

**Decision.** A section has one `data` (the draft) and a `publishedAt`. The
public read returns only sections with `publishedAt` set; Publish stamps every
section and revalidates the site's ISR cache. There is no separate
"published data" copy.

**Why it holds.** Two mechanisms combine: the public API filters to published
sections (so an unpublished section is invisible), and the public page is
ISR-cached and only revalidated on Publish (so edits to an already-published
section do not reach customers until the next Publish). A separate snapshot
column would be a second source of truth to keep in sync for no gain.

### Contrast is enforced with pure black/white, not a near-black

**Decision.** `readableTextOn` chooses between `#000000` and `#ffffff`, not a
near-black. A mid-tone accent (luminance ~0.2) only reaches ~4.3:1 against a
near-black — under WCAG AA — while pure black clears it. Since the whole point
is that the guarantee actually holds for any accent the owner picks, the
candidates have to be the extremes. Theme is applied live (cosmetic, immediate),
so it sits outside the draft/publish cycle.

### Blocker: Next 16 renamed and re-signed two caching APIs

Two Next 16 changes surfaced building the site:
- `middleware.ts` is deprecated in favour of `proxy.ts` (`export default
  proxy`). Renamed; the custom-domain host→slug rewrite is unchanged.
- `revalidateTag(tag)` now requires a cache-life `profile` argument. Rather than
  guess the profile semantics, the revalidate route derives the slug from the
  `tenant-<slug>` tag and calls `revalidatePath('/' + slug)`, which needs no
  profile and revalidates exactly the tenant's page.

### The public site and custom domains resolve fail-closed

Both the public site read and custom-domain resolution reach RLS-protected data
without a tenant context, so both go through narrow `SECURITY DEFINER` functions
(`app_public_tenant`, `app_slug_by_domain`) — the same pattern as login — and
the `/api/public/*` routes are exempt from the bearer check. Live-data sections
(services, team) are resolved at read time from admin tables, so the public site
is never stale relative to the catalogue.

### Deferred

- **Automated Vercel Domains API** (programmatic domain add/verify) — the
  host→slug resolution and proxy are built; provisioning the domain on Vercel is
  a Pro-tier API call wired when a client brings a domain.
- **Section media/image uploads** (gallery, hero photo) — sections take image
  URLs today; a GCS upload path lands with object storage.
