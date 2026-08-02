import { Controller, Get, Module } from '@nestjs/common';

@Controller()
class HealthController {
  /**
   * Hit every 4 minutes by Cloud Scheduler during salon hours to keep the
   * instance warm. Stage 1 adds `SELECT 1` against Postgres here.
   */
  @Get('health')
  health() {
    return { ok: true, stage: 0 };
  }
}

@Module({
  controllers: [HealthController],
})
export class AppModule {}
