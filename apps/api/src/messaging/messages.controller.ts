import { Controller, Get, Query } from '@nestjs/common';
import { RequiresPermission } from '../access/guards.js';
import { PrismaService } from '../prisma.service.js';

/**
 * The message log — what was sent, to whom, and whether it made it out. Backs
 * the "message history" the front desk checks when a customer says they never
 * got a confirmation, and lets support see what is still queued.
 */
@Controller('messages')
export class MessagesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('recent')
  @RequiresPermission('customer.view')
  async recent(@Query('template') template?: string, @Query('status') status?: string) {
    const messages = await this.prisma.withTenant((tx) =>
      tx.message.findMany({
        where: {
          template: template || undefined,
          status: status || undefined,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    );
    return { messages };
  }
}
