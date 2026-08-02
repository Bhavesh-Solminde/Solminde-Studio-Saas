/**
 * Ledger rules shared by the POS and the API.
 *
 * The rule this file exists to enforce: NEVER store a running total. Wallet
 * balance, stock on hand and package sessions remaining are all SUM(delta) over
 * an append-only ledger. Offline merging is then addition, and addition
 * commutes — two devices syncing in any order reach the same number.
 *
 * Entries are immutable. A mistake is corrected by posting a reversing entry
 * with `reversesId` set, never by UPDATE or DELETE.
 */

export type LedgerType = 'wallet' | 'stock' | 'session';

export interface LedgerEntry {
  readonly id: string;
  readonly tenantId: string;
  /** Owner of the running total: customerId for wallet/session, productId for stock. */
  readonly ownerId: string;
  /** Signed change. Positive credits, negative debits. Never zero. */
  readonly delta: number;
  readonly reason: string;
  readonly billId?: string;
  readonly terminalId: string;
  /** Idempotency key of the operation that produced this entry. */
  readonly opId: string;
  /** Set only on a reversing entry, pointing at the entry it cancels. */
  readonly reversesId?: string;
  readonly createdAt: number;
}

/** Balance is always derived, never read from a column. */
export function balanceOf(entries: readonly LedgerEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.delta, 0);
}

/**
 * Build the reversing entry that cancels `entry`.
 *
 * Note it does not mutate or delete anything — it returns a new entry with the
 * opposite delta. This is what gives the audit log for free, and what makes a
 * bill void a new row rather than a mutation.
 */
export function reversalOf(
  entry: LedgerEntry,
  params: { id: string; opId: string; terminalId: string; reason: string; createdAt: number },
): LedgerEntry {
  return {
    id: params.id,
    tenantId: entry.tenantId,
    ownerId: entry.ownerId,
    delta: -entry.delta,
    reason: params.reason,
    billId: entry.billId,
    terminalId: params.terminalId,
    opId: params.opId,
    reversesId: entry.id,
    createdAt: params.createdAt,
  };
}

/**
 * Would this delta take the balance below zero?
 *
 * Deliberately NOT used to block the operation offline. Two terminals redeeming
 * more wallet than exists cannot be prevented without a network round trip, and
 * blocking the front desk is worse than the overdraft. The server detects it on
 * sync and surfaces it on the Exceptions screen for the owner to resolve.
 */
export function wouldOverdraw(currentBalance: number, delta: number): boolean {
  return currentBalance + delta < 0;
}
