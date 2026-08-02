import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { RequiresFeature } from '../access/guards.js';
import { PermissionsService } from '../access/permissions.service.js';
import { PrismaService } from '../prisma.service.js';
import { currentTenant } from '../tenant-context.js';
import { CommissionService } from './commission.service.js';

/**
 * Commission reporting, with the split that prevents salon-floor fights baked
 * into the endpoint itself: `commission.view_all` sees every stylist,
 * `commission.view_own` sees only themselves. This is an OR over two
 * permissions, which the single-permission guard cannot express, so it is
 * checked here — and it is enforced server-side, because hiding the other
 * stylists' numbers in the UI is not access control.
 */
@Controller('commissions')
export class CommissionsController {
  constructor(
    private readonly commissions: CommissionService,
    private readonly permissions: PermissionsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('summary')
  @RequiresFeature('commissions')
  async summary(@Query('from') from?: string, @Query('to') to?: string) {
    const { userId } = currentTenant();
    const perms = await this.permissions.resolve(userId);
    const canViewAll = perms.has('commission.view_all');
    const canViewOwn = perms.has('commission.view_own');
    if (!canViewAll && !canViewOwn) {
      throw new ForbiddenException('Not permitted to view commissions');
    }

    const now = new Date();
    const fromDate = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const toDate = to ? new Date(to) : new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const window = { from: fromDate.toISOString(), to: toDate.toISOString() };

    // A view-own user is scoped to their own staff record; nobody else's number
    // is computed, let alone returned. A user with no staff record sees nothing.
    let staffFilter: string[] | undefined;
    if (!canViewAll) {
      const staff = await this.prisma.withTenant((tx) =>
        tx.staff.findFirst({ where: { userId } }),
      );
      if (!staff) return { ...window, scope: 'own', rows: [] };
      staffFilter = [staff.id];
    }

    const rows = await this.commissions.summary(fromDate, toDate, staffFilter);
    return { ...window, scope: canViewAll ? 'all' : 'own', rows };
  }
}
