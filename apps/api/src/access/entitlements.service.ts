import { BadRequestException, Injectable } from '@nestjs/common';
import { FEATURE_DEPENDENCIES, type FeatureKey } from '@salon/shared';
import { PrismaService } from '../prisma.service.js';

/**
 * A feature is not simply on or off. `disabledButHasData` is the third state:
 * a salon turns off Packages while holding 47 unredeemed sessions worth
 * ₹80,000. Hiding the module would make a customer-facing liability silently
 * disappear, so redemption keeps working while new sales stop.
 */
export type FeatureState = 'enabled' | 'disabled' | 'disabledButHasData';

@Injectable()
export class EntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolution order: plan default -> tenant override -> trial expiry. */
  async resolve(tenantId: string): Promise<Map<FeatureKey, FeatureState>> {
    const [catalogue, overrides] = await Promise.all([
      this.prisma.feature.findMany(),
      this.prisma.tenantFeature.findMany({ where: { tenantId } }),
    ]);

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    const plan = tenant?.plan ?? 'standard';
    const byKey = new Map(overrides.map((o) => [o.key, o]));
    const resolved = new Map<FeatureKey, FeatureState>();

    for (const feature of catalogue) {
      const key = feature.key as FeatureKey;
      let enabled = feature.defaultTier === plan;

      const override = byKey.get(feature.key);
      if (override) {
        const expired = override.expiresAt !== null && override.expiresAt.getTime() < Date.now();
        // An expired trial falls back to the plan default rather than to off,
        // so ending a trial cannot revoke something the plan already included.
        enabled = expired ? enabled : override.enabled;
      }

      resolved.set(key, enabled ? 'enabled' : 'disabled');
    }

    return resolved;
  }

  async isEnabled(tenantId: string, key: FeatureKey): Promise<boolean> {
    return (await this.resolve(tenantId)).get(key) === 'enabled';
  }

  /**
   * Dependencies are enforced HERE, not in the UI. `commissions` needs
   * `billing`; `online_booking` needs `appointments` and `site_cms`. Turning a
   * dependency off either cascades or is blocked — it never leaves a feature
   * enabled with its foundation missing.
   */
  async setFeature(tenantId: string, key: FeatureKey, enabled: boolean): Promise<void> {
    if (enabled) {
      const missing: FeatureKey[] = [];
      for (const dependency of FEATURE_DEPENDENCIES[key] ?? []) {
        if (!(await this.isEnabled(tenantId, dependency))) missing.push(dependency);
      }
      if (missing.length > 0) {
        throw new BadRequestException(
          `${key} requires ${missing.join(', ')}. Enable those first.`,
        );
      }
    } else {
      const dependents = (Object.keys(FEATURE_DEPENDENCIES) as FeatureKey[]).filter((candidate) =>
        FEATURE_DEPENDENCIES[candidate].includes(key),
      );
      const active: FeatureKey[] = [];
      for (const dependent of dependents) {
        if (await this.isEnabled(tenantId, dependent)) active.push(dependent);
      }
      if (active.length > 0) {
        throw new BadRequestException(
          `${active.join(', ')} depend on ${key}. Disable those first.`,
        );
      }
    }

    await this.prisma.tenantFeature.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: { tenantId, key, enabled, source: 'override' },
      update: { enabled, source: 'override' },
    });
  }
}
