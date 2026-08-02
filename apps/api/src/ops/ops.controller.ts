import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { RequiresPermission } from '../access/guards.js';
import { PrismaService } from '../prisma.service.js';
import { currentTenant } from '../tenant-context.js';

const CONFLICT_TYPE = 'appointment_conflict';

const resolveBody = z.object({
  status: z.enum(['resolved', 'written_off', 'dismissed']),
  note: z.string().max(500).optional(),
});

/**
 * The two surfaces the owner needs for things that went sideways on sync, both
 * backed by `sync_exceptions` and split by type:
 *
 *   - Exceptions — overdrafts, negative stock, permission violations, expired or
 *     empty package redemptions.
 *   - Conflicts  — double-booked appointments.
 *
 * Nothing is ever silently dropped upstream; it lands here for a human to
 * resolve, which is the whole point of "allow, detect, surface".
 */
@Controller('ops')
export class OpsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('exceptions')
  @RequiresPermission('reports.view')
  async exceptions(@Query('status') status = 'open') {
    const rows = await this.prisma.withTenant((tx) =>
      tx.syncException.findMany({
        where: { status, type: { not: CONFLICT_TYPE } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
    return { rows };
  }

  @Get('conflicts')
  @RequiresPermission('reports.view')
  async conflicts(@Query('status') status = 'open') {
    const rows = await this.prisma.withTenant((tx) =>
      tx.syncException.findMany({
        where: { status, type: CONFLICT_TYPE },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
    return { rows };
  }

  @Post('exceptions/:id/resolve')
  @RequiresPermission('settings.edit')
  async resolve(@Param('id') id: string, @Body() raw: unknown) {
    const body = resolveBody.parse(raw);
    const { userId } = currentTenant();
    const updated = await this.prisma.withTenant((tx) =>
      tx.syncException.update({
        where: { id },
        data: { status: body.status, resolvedBy: userId },
      }),
    );
    return { ok: true, id: updated.id, status: updated.status };
  }
}
