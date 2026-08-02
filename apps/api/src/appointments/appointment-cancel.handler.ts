import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { FeatureKey, Permission } from '@salon/shared';
import { OpHandler, type OpMeta, type OpResult } from '../sync/op-handler.js';
import type { PrismaTx } from '../prisma.service.js';
import type { TenantCtx } from '../tenant-context.js';
import { AuditService } from '../audit/audit.service.js';

export const appointmentCancelPayload = z.object({
  id: z.uuid(),
  reason: z.string().max(500).optional(),
});

export type AppointmentCancelPayload = z.infer<typeof appointmentCancelPayload>;

/**
 * Cancel an appointment. Status flips to 'cancelled', which frees the slot —
 * availability and conflict checks only consider 'booked' rows, so a cancelled
 * appointment stops blocking its stylist and resource immediately. The row is
 * kept, not deleted, so the history and any conflict it was part of remain
 * legible.
 */
@Injectable()
export class AppointmentCancelHandler extends OpHandler<AppointmentCancelPayload> {
  readonly type = 'appointment.cancel';
  readonly schema = appointmentCancelPayload;
  readonly requiredFeatures: readonly FeatureKey[] = ['appointments'];
  readonly requiredPermissions: readonly Permission[] = ['appointment.cancel'];

  constructor(private readonly audit: AuditService) {
    super();
  }

  async apply(
    tx: PrismaTx,
    ctx: TenantCtx,
    payload: AppointmentCancelPayload,
    _op: OpMeta,
  ): Promise<OpResult> {
    const appt = await tx.appointment.findUnique({ where: { id: payload.id } });
    if (!appt) throw new Error(`Appointment not found: ${payload.id}`);

    await tx.appointment.update({
      where: { id: payload.id },
      data: { status: 'cancelled', rowVersion: { increment: 1 } },
    });

    await this.audit.record(tx, ctx, {
      action: 'appointment.cancel',
      entity: 'appointment',
      entityId: payload.id,
      before: { status: appt.status },
      after: { status: 'cancelled', reason: payload.reason ?? null },
    });

    return { ok: true, entity: 'appointment', id: payload.id, status: 'cancelled' };
  }
}
