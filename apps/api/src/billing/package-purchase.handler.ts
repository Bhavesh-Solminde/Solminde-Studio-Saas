import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { FeatureKey, Permission } from '@salon/shared';
import { OpHandler, type OpMeta, type OpResult } from '../sync/op-handler.js';
import type { PrismaTx } from '../prisma.service.js';
import type { TenantCtx } from '../tenant-context.js';
import { AuditService } from '../audit/audit.service.js';

export const packagePurchasePayload = z.object({
  // Device-generated CustomerPackage id.
  id: z.uuid(),
  customerId: z.uuid(),
  packageId: z.uuid(),
});

export type PackagePurchasePayload = z.infer<typeof packagePurchasePayload>;

/**
 * Sell a prepaid package. The sessions it grants are credited to the session
 * ledger — one entry per included service, quantity positive — and a
 * CustomerPackage row records the purchase and its expiry. Remaining sessions
 * are SUM(delta) over the ledger, never a stored count, so redemption and this
 * grant commute across offline terminals like every other balance.
 *
 * Expiry is computed from the package's validity at purchase time, so a later
 * change to the package definition cannot shorten a package a customer already
 * holds.
 */
@Injectable()
export class PackagePurchaseHandler extends OpHandler<PackagePurchasePayload> {
  readonly type = 'package.purchase';
  readonly schema = packagePurchasePayload;
  readonly requiredFeatures: readonly FeatureKey[] = ['packages'];
  readonly requiredPermissions: readonly Permission[] = ['bill.create'];

  constructor(private readonly audit: AuditService) {
    super();
  }

  async apply(
    tx: PrismaTx,
    ctx: TenantCtx,
    payload: PackagePurchasePayload,
    op: OpMeta,
  ): Promise<OpResult> {
    const pkg = await tx.package.findUnique({ where: { id: payload.packageId } });
    if (!pkg) throw new Error(`Package not found: ${payload.packageId}`);

    const items = await tx.packageItem.findMany({ where: { packageId: payload.packageId } });
    if (items.length === 0) throw new Error(`Package has no services: ${payload.packageId}`);

    const purchasedAt = new Date();
    const expiresAt = new Date(purchasedAt.getTime() + pkg.validityDays * 24 * 60 * 60 * 1000);

    await tx.customerPackage.create({
      data: {
        id: payload.id,
        tenantId: ctx.tenantId,
        customerId: payload.customerId,
        packageId: payload.packageId,
        purchasedAt,
        expiresAt,
      },
    });

    let granted = 0;
    for (const item of items) {
      granted += item.quantity;
      await tx.sessionLedger.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: ctx.tenantId,
          customerId: payload.customerId,
          packageId: payload.packageId,
          serviceId: item.serviceId,
          delta: item.quantity,
          terminalId: op.terminalId,
          opId: op.opId,
        },
      });
    }

    await this.audit.record(tx, ctx, {
      action: 'package.purchase',
      entity: 'customer_package',
      entityId: payload.id,
      after: { packageId: payload.packageId, customerId: payload.customerId, granted, expiresAt },
    });

    return { ok: true, entity: 'customer_package', id: payload.id, granted, expiresAt };
  }
}
