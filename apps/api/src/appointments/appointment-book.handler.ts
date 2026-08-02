import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { FeatureKey, Permission } from '@salon/shared';
import { OpHandler, type OpMeta, type OpResult } from '../sync/op-handler.js';
import type { PrismaTx } from '../prisma.service.js';
import type { TenantCtx } from '../tenant-context.js';
import { AppointmentService } from './appointment.service.js';
import { AuditService } from '../audit/audit.service.js';

export const appointmentBookPayload = z.object({
  id: z.uuid(),
  customerId: z.uuid(),
  staffId: z.uuid().nullish(),
  resourceId: z.uuid().nullish(),
  serviceId: z.uuid(),
  /** Epoch ms; device clock, so an offline booking keeps the time it was made. */
  startAt: z.number().int(),
  endAt: z.number().int(),
  notes: z.string().max(1000).optional(),
  source: z.enum(['pos', 'online', 'whatsapp']).optional(),
});

export type AppointmentBookPayload = z.infer<typeof appointmentBookPayload>;

@Injectable()
export class AppointmentBookHandler extends OpHandler<AppointmentBookPayload> {
  readonly type = 'appointment.book';
  readonly schema = appointmentBookPayload;
  readonly requiredFeatures: readonly FeatureKey[] = ['appointments'];
  readonly requiredPermissions: readonly Permission[] = ['appointment.create'];

  constructor(
    private readonly appointments: AppointmentService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async apply(
    tx: PrismaTx,
    ctx: TenantCtx,
    payload: AppointmentBookPayload,
    _op: OpMeta,
  ): Promise<OpResult> {
    const { appointmentId, conflict } = await this.appointments.book(tx, ctx, {
      id: payload.id,
      customerId: payload.customerId,
      staffId: payload.staffId,
      resourceId: payload.resourceId,
      serviceId: payload.serviceId,
      startAt: new Date(payload.startAt),
      endAt: new Date(payload.endAt),
      source: payload.source ?? 'pos',
      notes: payload.notes,
    });

    await this.audit.record(tx, ctx, {
      action: 'appointment.book',
      entity: 'appointment',
      entityId: appointmentId,
      after: { startAt: payload.startAt, staffId: payload.staffId, conflict },
    });

    return { ok: true, entity: 'appointment', id: appointmentId, conflict };
  }
}
