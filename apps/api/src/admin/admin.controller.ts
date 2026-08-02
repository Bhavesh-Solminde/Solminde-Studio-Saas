import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { FEATURES, type FeatureKey } from '@salon/shared';
import { RequiresPermission } from '../access/guards.js';
import { EntitlementsService } from '../access/entitlements.service.js';
import { ReportsService } from '../reports/reports.service.js';
import { ImportService } from './import.service.js';
import { currentTenant } from '../tenant-context.js';

const toggleBody = z.object({ enabled: z.boolean() });
const importBody = z.object({ csv: z.string() });

/**
 * The owner's admin surface: feature toggles and onboarding CSV import.
 *
 * Entitlement dependencies are enforced server-side in EntitlementsService, not
 * here and not in the UI — turning on `commissions` without `billing`, or off a
 * feature something depends on, is rejected with a 400. Disabling a feature is
 * read-only, never destructive: disabling Packages stops NEW package sales (the
 * `package.purchase` op requires the feature) while existing sessions stay
 * redeemable, because redemption is a line inside `bill.create`, which only
 * requires `billing`. The liability endpoint is what the UI shows before the
 * owner confirms that disable.
 */
@Controller('admin')
export class AdminController {
  constructor(
    private readonly entitlements: EntitlementsService,
    private readonly reports: ReportsService,
    private readonly imports: ImportService,
  ) {}

  private async featureList(tenantId: string) {
    const resolved = await this.entitlements.resolve(tenantId);
    return { features: [...resolved.entries()].map(([key, state]) => ({ key, state })) };
  }

  @Get('features')
  @RequiresPermission('settings.features')
  async features() {
    return this.featureList(currentTenant().tenantId);
  }

  /** What the owner must see before disabling Packages: the outstanding liability. */
  @Get('features/packages/liability')
  @RequiresPermission('settings.features')
  async packageLiability() {
    return this.reports.packageLiability();
  }

  @Post('features/:key')
  @RequiresPermission('settings.features')
  async toggle(@Param('key') key: string, @Body() raw: unknown) {
    if (!FEATURES.includes(key as FeatureKey)) {
      throw new BadRequestException(`Unknown feature: ${key}`);
    }
    const { enabled } = toggleBody.parse(raw);
    const { tenantId } = currentTenant();
    // Throws BadRequest on a dependency violation — the UI surfaces the message.
    await this.entitlements.setFeature(tenantId, key as FeatureKey, enabled);
    return this.featureList(tenantId);
  }

  @Post('import/customers')
  @RequiresPermission('settings.edit')
  async importCustomers(@Body() raw: unknown) {
    return this.imports.importCustomers(importBody.parse(raw).csv);
  }

  @Post('import/services')
  @RequiresPermission('settings.edit')
  async importServices(@Body() raw: unknown) {
    return this.imports.importServices(importBody.parse(raw).csv);
  }

  @Post('import/products')
  @RequiresPermission('settings.edit')
  async importProducts(@Body() raw: unknown) {
    return this.imports.importProducts(importBody.parse(raw).csv);
  }
}
