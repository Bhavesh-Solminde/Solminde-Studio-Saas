import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma.service.js';
import { tenantStorage, type TenantCtx } from '../tenant-context.js';
import { AvailabilityService } from './availability.service.js';
import { AppointmentService } from './appointment.service.js';
import { MessagingService } from '../messaging/messaging.service.js';

interface PublicTenantRow {
  tenant_id: string;
  name: string;
  timezone: string;
  status: string;
}

const bookBody = z.object({
  customerName: z.string().min(1).max(120),
  customerPhone: z.string().min(6).max(20),
  serviceId: z.uuid(),
  staffId: z.uuid().optional(),
  resourceId: z.uuid().optional(),
  /** ISO datetime of the chosen slot start. */
  startAt: z.string(),
});

/**
 * The public online-booking API, consumed by the Next.js salon site. It is
 * unauthenticated — a walk-in has no login — so it is mounted under `/api/public`
 * (which the tenant middleware lets through) and resolves the salon from its
 * slug via a narrow SECURITY DEFINER function, the same fail-closed pattern as
 * login. Everything after resolution runs inside that tenant's RLS scope.
 *
 * This is the commercially important surface: it is the page that converts a
 * customer for the client, and its "live" slot availability is what makes a
 * booked slot disappear the instant it is taken.
 */
@Controller('public')
export class PublicBookingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availabilitySvc: AvailabilityService,
    private readonly appointments: AppointmentService,
    private readonly messaging: MessagingService,
  ) {}

  private async resolveTenant(slug: string): Promise<PublicTenantRow> {
    const rows = await this.prisma.$queryRaw<PublicTenantRow[]>`
      SELECT * FROM app_public_tenant(${slug})
    `;
    const found = rows[0];
    if (!found || found.status !== 'active') throw new NotFoundException('Salon not found');
    return found;
  }

  /** Run `fn` inside the resolved tenant's context (no user — this is public). */
  private async asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const ctx: TenantCtx = { tenantId, userId: '', role: 'public' };
    return tenantStorage.run(ctx, fn);
  }

  @Get(':slug/services')
  async services(@Param('slug') slug: string) {
    const tenant = await this.resolveTenant(slug);
    return this.asTenant(tenant.tenant_id, () =>
      this.prisma.withTenant((tx) =>
        tx.service.findMany({
          where: { active: true },
          select: { id: true, name: true, durationMin: true, price: true },
          orderBy: { name: 'asc' },
        }),
      ),
    );
  }

  @Get(':slug/availability')
  async availability(
    @Param('slug') slug: string,
    @Query('serviceId') serviceId: string,
    @Query('date') date: string,
    @Query('staffId') staffId?: string,
  ) {
    const tenant = await this.resolveTenant(slug);
    const slots = await this.asTenant(tenant.tenant_id, () =>
      this.availabilitySvc.slots({ serviceId, staffId, date }),
    );
    return { slots };
  }

  @Post(':slug/book')
  async book(@Param('slug') slug: string, @Body() raw: unknown) {
    const body = bookBody.parse(raw);
    const tenant = await this.resolveTenant(slug);

    return this.asTenant(tenant.tenant_id, async () => {
      const ctx: TenantCtx = { tenantId: tenant.tenant_id, userId: '', role: 'public' };

      return this.prisma.withTenant(async (tx) => {
        const service = await tx.service.findUnique({ where: { id: body.serviceId } });
        if (!service) throw new NotFoundException('Service not found');

        const start = new Date(body.startAt);
        const end = new Date(start.getTime() + service.durationMin * 60_000);

        // An online booking with no chosen stylist still occupies a chair.
        // Assign the first free one; if none is free the slot is genuinely gone.
        const resourceId =
          body.resourceId ?? (await this.appointments.firstFreeResource(tx, { startAt: start, endAt: end }));
        if (!resourceId) throw new ConflictException('That slot is no longer available');

        // A booking customer is identified by phone, upserted so a repeat
        // visitor is one record rather than a duplicate on every booking.
        const customer = await tx.customer.upsert({
          where: { tenantId_phone: { tenantId: tenant.tenant_id, phone: body.customerPhone } },
          create: {
            tenantId: tenant.tenant_id,
            name: body.customerName,
            phone: body.customerPhone,
          },
          update: { name: body.customerName },
        });

        const { appointmentId, conflict } = await this.appointments.book(tx, ctx, {
          id: crypto.randomUUID(),
          customerId: customer.id,
          staffId: body.staffId ?? null,
          resourceId,
          serviceId: body.serviceId,
          startAt: start,
          endAt: end,
          source: 'online',
          notes: null,
        });

        await this.messaging.queue(tx, ctx, {
          toPhone: body.customerPhone,
          template: 'booking_confirm',
          payload: {
            name: body.customerName,
            service: service.name,
            startAt: start.toISOString(),
            salon: tenant.name,
          },
        });

        return { appointmentId, startAt: start.toISOString(), endAt: end.toISOString(), conflict };
      });
    });
  }
}
