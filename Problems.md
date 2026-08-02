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
