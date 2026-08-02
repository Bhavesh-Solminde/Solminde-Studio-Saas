import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';

// Salon business hours and slot granularity. A roster/shift model (P1) would
// make these per-staff and per-day; until then a single open window is enough to
// drive online booking, and it is the one place to change when that lands.
const OPEN_HOUR = 10;
const CLOSE_HOUR = 20;
const STEP_MIN = 30;

export interface Slot {
  startAt: string;
  endAt: string;
}

interface Booked {
  staffId: string | null;
  resourceId: string | null;
  startAt: Date;
  endAt: Date;
}

const overlaps = (a: Booked, start: Date, end: Date): boolean =>
  a.startAt < end && a.endAt > start;

/**
 * Free appointment slots for a service on a given day.
 *
 * A slot is offered when it fits inside business hours, the requested stylist
 * (if any) is free, and at least one chair is free — capacity, the thing an
 * online booking with no chosen stylist still consumes. The moment a slot is
 * booked on any surface, the next call stops offering it, which is what blocks
 * the slot across the booking page and the POS.
 *
 * The day's bookings and the resource list are read ONCE and the slot loop runs
 * in memory. This is the booking page's render path — commercially the one that
 * matters — so it must not fan out into a query per slot.
 */
@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async slots(params: {
    serviceId: string;
    staffId?: string;
    date: string; // YYYY-MM-DD
  }): Promise<Slot[]> {
    return this.prisma.withTenant(async (tx) => {
      const service = await tx.service.findUnique({ where: { id: params.serviceId } });
      if (!service) return [];
      const duration = service.durationMin;

      const dayStart = new Date(`${params.date}T00:00:00.000Z`);
      const open = new Date(dayStart.getTime() + OPEN_HOUR * 3600_000);
      const close = new Date(dayStart.getTime() + CLOSE_HOUR * 3600_000);

      const [resources, booked] = await Promise.all([
        tx.resource.findMany({ select: { id: true } }),
        tx.appointment.findMany({
          where: { status: 'booked', startAt: { lt: close }, endAt: { gt: open } },
          select: { staffId: true, resourceId: true, startAt: true, endAt: true },
        }),
      ]);

      const out: Slot[] = [];
      for (
        let start = open;
        start.getTime() + duration * 60_000 <= close.getTime();
        start = new Date(start.getTime() + STEP_MIN * 60_000)
      ) {
        const end = new Date(start.getTime() + duration * 60_000);

        if (params.staffId) {
          const staffBusy = booked.some(
            (b) => b.staffId === params.staffId && overlaps(b, start, end),
          );
          if (staffBusy) continue;
        }

        const chairFree = resources.some(
          (r) => !booked.some((b) => b.resourceId === r.id && overlaps(b, start, end)),
        );
        if (chairFree) out.push({ startAt: start.toISOString(), endAt: end.toISOString() });
      }
      return out;
    });
  }
}
