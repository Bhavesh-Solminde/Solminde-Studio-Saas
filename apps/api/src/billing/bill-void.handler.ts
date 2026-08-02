import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { FeatureKey, Permission } from '@salon/shared';
import { OpHandler, type OpMeta, type OpResult } from '../sync/op-handler.js';
import type { PrismaTx } from '../prisma.service.js';
import type { TenantCtx } from '../tenant-context.js';
import { LedgerService } from './ledger.service.js';

export const billVoidPayload = z.object({
  billId: z.uuid(),
  reason: z.string().min(1).max(200),
});

export type BillVoidPayload = z.infer<typeof billVoidPayload>;

/**
 * A void (and a refund) is a reversing entry, never a mutation of history.
 *
 * The original bill row stays exactly as printed; its status flips to 'void'
 * and every ledger entry it created gets a mirror-image entry that cancels it.
 * Stock the sale removed comes back, wallet the customer redeemed is restored,
 * and the audit trail reads sale-then-void rather than a bill that silently
 * changed. Idempotency is handled upstream by processed_ops, so a replayed void
 * never double-reverses.
 */
@Injectable()
export class BillVoidHandler extends OpHandler<BillVoidPayload> {
  readonly type = 'bill.void';
  readonly schema = billVoidPayload;
  readonly requiredFeatures: readonly FeatureKey[] = ['billing'];
  readonly requiredPermissions: readonly Permission[] = ['bill.void'];

  constructor(private readonly ledgers: LedgerService) {
    super();
  }

  async apply(
    tx: PrismaTx,
    _ctx: TenantCtx,
    payload: BillVoidPayload,
    op: OpMeta,
  ): Promise<OpResult> {
    const bill = await tx.bill.findUnique({ where: { id: payload.billId } });
    if (!bill) throw new Error(`Bill not found: ${payload.billId}`);
    if (bill.status === 'void') throw new Error(`Bill already void: ${bill.invoiceNo}`);

    await tx.bill.update({
      where: { id: bill.id },
      data: { status: 'void', rowVersion: { increment: 1 } },
    });

    await this.ledgers.reverseBill(tx, bill.id, {
      opId: op.opId,
      terminalId: op.terminalId,
      reason: `void: ${payload.reason}`,
    });

    return { ok: true, entity: 'bill', id: bill.id, status: 'void' };
  }
}
