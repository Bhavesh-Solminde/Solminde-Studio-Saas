import { Injectable } from '@nestjs/common';
import type { PrismaTx } from '../prisma.service.js';

/**
 * The server side of the ledger model (spec §3).
 *
 * Three ledgers, one set of invariants, one place to fix a bug. Every method
 * here is append-only: there is no update and no delete, ever. A mistake is
 * corrected by posting a reversing entry, which is what gives the audit trail
 * for free and makes a bill void a new row rather than a mutation.
 *
 * All queries run on the caller's transaction (`tx`), so RLS has already scoped
 * them to the current tenant — there is no `WHERE tenantId` here, and there must
 * not be, because that is precisely the clause a human forgets.
 *
 * Balances are SUM(delta), never a stored column. The `_sum` aggregate pushes
 * the addition into Postgres rather than loading every row into Node.
 */
@Injectable()
export class LedgerService {
  async walletBalance(tx: PrismaTx, customerId: string): Promise<number> {
    const { _sum } = await tx.walletLedger.aggregate({
      _sum: { delta: true },
      where: { customerId },
    });
    return _sum.delta ?? 0;
  }

  async stockOnHand(tx: PrismaTx, productId: string): Promise<number> {
    const { _sum } = await tx.stockLedger.aggregate({
      _sum: { delta: true },
      where: { productId },
    });
    return _sum.delta ?? 0;
  }

  /**
   * The one operation that does not commute: an overdraft. Two offline
   * terminals can each redeem more wallet than exists, or sell stock that isn't
   * there, and no amount of clever merging can prevent it without a network
   * round trip. So we DO NOT block it — we let the entry through and record an
   * exception for the owner to resolve on the Exceptions screen. Blocking the
   * front desk would be worse than the overdraft, which for a single-counter
   * salon has near-zero probability anyway.
   */
  async flagIfNegative(
    tx: PrismaTx,
    tenantId: string,
    params: {
      balance: number;
      type: 'wallet_overdraft' | 'negative_stock';
      ownerId: string;
      billId: string;
      terminalId: string;
    },
  ): Promise<void> {
    if (params.balance >= 0) return;
    await tx.syncException.create({
      data: {
        tenantId,
        type: params.type,
        detail: {
          ownerId: params.ownerId,
          billId: params.billId,
          terminalId: params.terminalId,
          balance: params.balance,
        },
      },
    });
  }

  /**
   * Post reversing entries for every wallet, stock and session row tied to a
   * bill. This is how a void or refund works: not by deleting the originals but
   * by adding their mirror image, so the ledger still sums correctly and the
   * history of what happened — sale then reversal — remains legible.
   */
  async reverseBill(
    tx: PrismaTx,
    billId: string,
    meta: { opId: string; terminalId: string; reason: string },
  ): Promise<void> {
    // A reversal is just the mirror entry: same owner, negated delta, pointing
    // at the row it cancels. Identical shape across all three ledgers, so it is
    // expressed once rather than three near-copies.
    const wallet = await tx.walletLedger.findMany({ where: { billId, reversesId: null } });
    for (const e of wallet) {
      await tx.walletLedger.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: e.tenantId,
          customerId: e.customerId,
          delta: -e.delta,
          reason: meta.reason,
          billId,
          terminalId: meta.terminalId,
          opId: meta.opId,
          reversesId: e.id,
        },
      });
    }

    const stock = await tx.stockLedger.findMany({ where: { billId, reversesId: null } });
    for (const e of stock) {
      await tx.stockLedger.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: e.tenantId,
          productId: e.productId,
          locationId: e.locationId,
          delta: -e.delta,
          reason: meta.reason,
          billId,
          terminalId: meta.terminalId,
          opId: meta.opId,
          reversesId: e.id,
        },
      });
    }

    const session = await tx.sessionLedger.findMany({ where: { billId, reversesId: null } });
    for (const e of session) {
      await tx.sessionLedger.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: e.tenantId,
          customerId: e.customerId,
          packageId: e.packageId,
          serviceId: e.serviceId,
          delta: -e.delta,
          billId,
          terminalId: meta.terminalId,
          opId: meta.opId,
          reversesId: e.id,
        },
      });
    }
  }
}
