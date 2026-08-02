import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { FeatureKey, Permission } from '@salon/shared';
import { OpHandler, type OpMeta, type OpResult } from '../sync/op-handler.js';
import type { PrismaTx } from '../prisma.service.js';
import type { TenantCtx } from '../tenant-context.js';
import { AuditService } from '../audit/audit.service.js';

export const membershipPurchasePayload = z.object({
  customerId: z.uuid(),
  membershipId: z.uuid(),
});

export type MembershipPurchasePayload = z.infer<typeof membershipPurchasePayload>;

/**
 * Sell a membership. The only balance effect modelled here is the wallet credit
 * it carries — posted as a single positive entry on the wallet ledger, so the
 * customer's balance stays SUM(delta) and never a stored total. Benefit rules
 * beyond the wallet credit are out of scope for this stage.
 */
@Injectable()
export class MembershipPurchaseHandler extends OpHandler<MembershipPurchasePayload> {
  readonly type = 'membership.purchase';
  readonly schema = membershipPurchasePayload;
  readonly requiredFeatures: readonly FeatureKey[] = ['memberships'];
  readonly requiredPermissions: readonly Permission[] = ['bill.create'];

  constructor(private readonly audit: AuditService) {
    super();
  }

  async apply(
    tx: PrismaTx,
    ctx: TenantCtx,
    payload: MembershipPurchasePayload,
    op: OpMeta,
  ): Promise<OpResult> {
    const membership = await tx.membership.findUnique({ where: { id: payload.membershipId } });
    if (!membership) throw new Error(`Membership not found: ${payload.membershipId}`);

    const entry = await tx.walletLedger.create({
      data: {
        id: crypto.randomUUID(),
        tenantId: ctx.tenantId,
        customerId: payload.customerId,
        delta: membership.walletCredit,
        reason: 'membership',
        terminalId: op.terminalId,
        opId: op.opId,
      },
    });

    await this.audit.record(tx, ctx, {
      action: 'membership.purchase',
      entity: 'membership',
      entityId: payload.membershipId,
      after: { customerId: payload.customerId, walletCredit: membership.walletCredit },
    });

    return { ok: true, entity: 'wallet_ledger', id: entry.id, walletCredit: membership.walletCredit };
  }
}
