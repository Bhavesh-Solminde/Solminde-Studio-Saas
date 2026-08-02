import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { syncPushRequestSchema } from '@salon/shared';
import { SyncService } from './sync.service.js';

@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  /**
   * Batched at ~50 ops by the client. Each op is independently transactional,
   * so one bad op cannot roll back the other forty-nine.
   */
  @Post('push')
  async push(@Body() raw: unknown) {
    const { ops } = syncPushRequestSchema.parse(raw);
    return { outcomes: await this.sync.push(ops) };
  }

  @Get('pull')
  async pull(@Query('since') since?: string, @Query('tables') tables?: string) {
    const list = (tables ?? 'customers,services,products,staff,roles').split(',').filter(Boolean);
    return this.sync.pull(since ? new Date(since) : null, list);
  }
}
