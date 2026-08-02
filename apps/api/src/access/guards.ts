import type {
  CanActivate,
  ExecutionContext} from '@nestjs/common';
import {
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FeatureKey, Permission } from '@salon/shared';
import { currentTenant } from '../tenant-context.js';
import { EntitlementsService } from './entitlements.service.js';
import { PermissionsService } from './permissions.service.js';

export const FEATURE_KEY = 'requiredFeature';
export const PERMISSION_KEY = 'requiredPermission';

/** Does this SALON have the feature? Set by us, as a commercial decision. */
export const RequiresFeature = (feature: FeatureKey) => SetMetadata(FEATURE_KEY, feature);

/** May this USER perform the action? Set by the salon owner. */
export const RequiresPermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);

/**
 * Both guards are mandatory on every mutating route. Make it a code-review
 * rule: retrofitting guards onto forty existing endpoints later is tedious,
 * error-prone, and some will be missed.
 *
 * Hiding UI is not access control. A stylist can open devtools and flip a
 * localStorage flag; only this runs on the server.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const feature = this.reflector.getAllAndOverride<FeatureKey>(FEATURE_KEY, targets);
    const permission = this.reflector.getAllAndOverride<Permission>(PERMISSION_KEY, targets);

    if (!feature && !permission) return true;

    const { tenantId, userId } = currentTenant();

    if (feature && !(await this.entitlements.isEnabled(tenantId, feature))) {
      throw new ForbiddenException(`Feature not enabled for this salon: ${feature}`);
    }

    if (permission && !(await this.permissions.has(userId, permission))) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }

    return true;
  }
}
