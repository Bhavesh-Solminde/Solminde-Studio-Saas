import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { FeatureKey, Permission } from '@salon/shared';
import { OpHandler, type OpResult } from '../sync/op-handler.js';
import type { PrismaTx } from '../prisma.service.js';
import type { TenantCtx } from '../tenant-context.js';

export const customerCreatePayload = z.object({
  // The device generates the id so the local row and the server row are the
  // same record. Letting the server assign it would mean reconciling two
  // identities for one customer after every sync.
  id: z.uuid(),
  name: z.string().min(1).max(120),
  phone: z.string().min(6).max(20),
  email: z.email().optional(),
  notes: z.string().max(2000).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
});

export type CustomerCreatePayload = z.infer<typeof customerCreatePayload>;

@Injectable()
export class CustomerCreateHandler extends OpHandler<CustomerCreatePayload> {
  readonly type = 'customer.create';
  readonly schema = customerCreatePayload;
  readonly requiredFeatures: readonly FeatureKey[] = ['customers'];
  readonly requiredPermissions: readonly Permission[] = ['customer.edit'];

  async apply(tx: PrismaTx, ctx: TenantCtx, payload: CustomerCreatePayload): Promise<OpResult> {
    // Phone is the lookup key the front desk actually uses, and it is unique
    // per tenant. Two terminals registering the same walk-in offline is a real
    // scenario, so this upserts rather than failing — the second device's
    // write becomes an update, not a duplicate customer and not an error.
    const customer = await tx.customer.upsert({
      where: { tenantId_phone: { tenantId: ctx.tenantId, phone: payload.phone } },
      create: {
        id: payload.id,
        tenantId: ctx.tenantId,
        name: payload.name,
        phone: payload.phone,
        email: payload.email ?? null,
        notes: payload.notes ?? null,
        tags: payload.tags ?? [],
      },
      update: {
        name: payload.name,
        email: payload.email ?? null,
        notes: payload.notes ?? null,
        tags: payload.tags ?? [],
        rowVersion: { increment: 1 },
      },
    });

    return { ok: true, entity: 'customer', id: customer.id };
  }
}
