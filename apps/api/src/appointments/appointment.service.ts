import { Injectable } from '@nestjs/common';
import type { PrismaTx } from '../prisma.service.js';
import type { TenantCtx } from '../tenant-context.js';

export interface BookParams {
  id: string;
  customerId: string;
  staffId?: string | null;
  resourceId?: string | null;
  serviceId: string;
  startAt: Date;
  endAt: Date;
  source: 'pos' | 'online' | 'whatsapp';
  notes?: string | null;
}

/**
 * Booking and conflict detection, shared by the POS op handler and the public
 * online-booking controller so both create appointments the same way.
 *
 * Conflicts are DETECTED, not prevented. Per the spec: accept both, show both,
 * let the front desk resolve — never silently drop one. An online booking and a
 * POS booking for the same chair at the same minute can genuinely race, and the
 * offline model means neither side can guarantee it saw the other first. So the
 * appointment is always created; an overlap on the same stylist or the same
 * resource additionally records an `appointment_conflict` for the Conflicts
 * screen.
 */
@Injectable()
export class AppointmentService {
  async book(
    tx: PrismaTx,
    ctx: TenantCtx,
    params: BookParams,
  ): Promise<{ appointmentId: string; conflict: boolean }> {
    await tx.appointment.create({
      data: {
        id: params.id,
        tenantId: ctx.tenantId,
        customerId: params.customerId,
        staffId: params.staffId ?? null,
        resourceId: params.resourceId ?? null,
        serviceId: params.serviceId,
        startAt: params.startAt,
        endAt: params.endAt,
        status: 'booked',
        source: params.source,
        notes: params.notes ?? null,
      },
    });

    const conflicts = await this.overlapping(tx, {
      excludeId: params.id,
      staffId: params.staffId,
      resourceId: params.resourceId,
      startAt: params.startAt,
      endAt: params.endAt,
    });

    if (conflicts.length > 0) {
      await tx.syncException.create({
        data: {
          tenantId: ctx.tenantId,
          type: 'appointment_conflict',
          detail: {
            appointmentId: params.id,
            conflictsWith: conflicts.map((c) => c.id),
            staffId: params.staffId ?? null,
            resourceId: params.resourceId ?? null,
            startAt: params.startAt.toISOString(),
          },
        },
      });
    }

    return { appointmentId: params.id, conflict: conflicts.length > 0 };
  }

  /**
   * The first resource (chair/room) with no booked appointment overlapping the
   * window — i.e. a free chair for this slot. Returns null when the salon is at
   * capacity. This is what an online booking with no chosen stylist is assigned
   * to, and what makes "a slot is free" mean "a chair is free".
   */
  async firstFreeResource(
    tx: PrismaTx,
    q: { startAt: Date; endAt: Date; excludeId?: string },
  ): Promise<string | null> {
    const resources = await tx.resource.findMany({ select: { id: true } });
    for (const resource of resources) {
      const clash = await this.overlapping(tx, {
        excludeId: q.excludeId,
        resourceId: resource.id,
        startAt: q.startAt,
        endAt: q.endAt,
      });
      if (clash.length === 0) return resource.id;
    }
    return null;
  }

  /**
   * Booked appointments that overlap the given window on the same stylist or the
   * same resource. Two appointments overlap when each starts before the other
   * ends — the standard half-open interval test, so back-to-back bookings that
   * merely touch at an edge do not count.
   */
  async overlapping(
    tx: PrismaTx,
    q: {
      excludeId?: string;
      staffId?: string | null;
      resourceId?: string | null;
      startAt: Date;
      endAt: Date;
    },
  ): Promise<{ id: string }[]> {
    const who: { staffId?: string; resourceId?: string }[] = [];
    if (q.staffId) who.push({ staffId: q.staffId });
    if (q.resourceId) who.push({ resourceId: q.resourceId });
    if (who.length === 0) return [];

    return tx.appointment.findMany({
      where: {
        status: 'booked',
        id: q.excludeId ? { not: q.excludeId } : undefined,
        OR: who,
        startAt: { lt: q.endAt },
        endAt: { gt: q.startAt },
      },
      select: { id: true },
    });
  }
}
