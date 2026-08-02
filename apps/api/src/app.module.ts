import type { MiddlewareConsumer} from '@nestjs/common';
import { Controller, Get, Module, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaService } from './prisma.service.js';
import { TenantMiddleware } from './tenant.middleware.js';
import { AuthService } from './auth/auth.service.js';
import { TokenService } from './auth/token.service.js';
import { AuthController } from './auth/auth.controller.js';
import { EntitlementsService } from './access/entitlements.service.js';
import { PermissionsService } from './access/permissions.service.js';
import { AccessGuard } from './access/guards.js';
import { OP_HANDLER, type OpHandler } from './sync/op-handler.js';
import { SyncService } from './sync/sync.service.js';
import { SyncController } from './sync/sync.controller.js';
import { CustomerCreateHandler } from './customers/customer-create.handler.js';
import { LedgerService } from './billing/ledger.service.js';
import { InvoiceLeaseService } from './billing/invoice-lease.service.js';
import { BillingController } from './billing/billing.controller.js';
import { BillCreateHandler } from './billing/bill-create.handler.js';
import { BillVoidHandler } from './billing/bill-void.handler.js';
import { WalletTopupHandler } from './billing/wallet-topup.handler.js';
import { DayCloseHandler } from './billing/day-close.handler.js';
import { PackagePurchaseHandler } from './billing/package-purchase.handler.js';
import { MembershipPurchaseHandler } from './billing/membership-purchase.handler.js';
import { AuditService } from './audit/audit.service.js';
import { CommissionService } from './commissions/commission.service.js';
import { CommissionsController } from './commissions/commissions.controller.js';

@Controller()
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Hit every 4 minutes by Cloud Scheduler during salon hours (9am-10pm) to
   * keep the instance warm. The API cold start is larger than the database's
   * and it is the one on our side.
   */
  @Get('health')
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { ok: true, stage: 3 };
  }
}

/**
 * Every OpHandler is registered here and nowhere else. Adding a syncable
 * operation is one new class plus one line in this array — the sync engine
 * itself never changes.
 */
const OP_HANDLERS = [
  CustomerCreateHandler,
  BillCreateHandler,
  BillVoidHandler,
  WalletTopupHandler,
  DayCloseHandler,
  PackagePurchaseHandler,
  MembershipPurchaseHandler,
];

@Module({
  controllers: [
    HealthController,
    AuthController,
    SyncController,
    BillingController,
    CommissionsController,
  ],
  providers: [
    PrismaService,
    AuthService,
    TokenService,
    EntitlementsService,
    PermissionsService,
    LedgerService,
    InvoiceLeaseService,
    AuditService,
    CommissionService,
    SyncService,
    ...OP_HANDLERS,
    {
      provide: OP_HANDLER,
      useFactory: (...handlers: OpHandler<unknown>[]) => handlers,
      inject: OP_HANDLERS,
    },
    // Applied globally so a route without the decorators is open by omission
    // only where that is intended, and every decorated route is enforced.
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantMiddleware).forRoutes('{*path}');
  }
}
