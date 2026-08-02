import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { FeatureKey, Permission } from '@salon/shared';
import { OpHandler, type OpMeta, type OpResult } from '../sync/op-handler.js';
import type { PrismaTx } from '../prisma.service.js';
import type { TenantCtx } from '../tenant-context.js';

export const walletTopupPayload = z.object({
  customerId: z.uuid(),
  /** Positive paise loaded into the wallet. */
  amount: z.number().int().positive(),
  reason: z.string().max(80).optional(),
});

export type WalletTopupPayload = z.infer<typeof walletTopupPayload>;

/**
 * Load a customer's prepaid wallet — the "advance" a salon takes against future
 * visits. It is one positive entry on the wallet ledger; the balance stays
 * SUM(delta) and nothing is ever stored as a running total. Redemption happens
 * later at billing, as a negative entry.
 */
@Injectable()
export class WalletTopupHandler extends OpHandler<WalletTopupPayload> {
  readonly type = 'wallet.topup';
  readonly schema = walletTopupPayload;
  readonly requiredFeatures: readonly FeatureKey[] = ['billing'];
  readonly requiredPermissions: readonly Permission[] = ['bill.create'];

  async apply(
    tx: PrismaTx,
    ctx: TenantCtx,
    payload: WalletTopupPayload,
    op: OpMeta,
  ): Promise<OpResult> {
    const entry = await tx.walletLedger.create({
      data: {
        id: crypto.randomUUID(),
        tenantId: ctx.tenantId,
        customerId: payload.customerId,
        delta: payload.amount,
        reason: payload.reason ?? 'topup',
        terminalId: op.terminalId,
        opId: op.opId,
      },
    });
    return { ok: true, entity: 'wallet_ledger', id: entry.id };
  }
}
