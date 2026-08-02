import { Injectable } from '@nestjs/common';
import type { Permission } from '@salon/shared';
import { PrismaService } from '../prisma.service.js';

/**
 * Role-based with per-user overrides. Never pure per-user ACLs — a salon owner
 * will not configure forty checkboxes per stylist.
 */
@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(userId: string): Promise<Set<Permission>> {
    // withTenant, not a bare query: these tables are RLS-protected, so a query
    // outside a tenant transaction silently returns nothing. If an existing
    // transaction is in scope this joins it rather than nesting.
    return this.prisma.withTenant(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) return new Set<Permission>();

      const granted = new Set<Permission>();

      if (user.roleId) {
        const role = await tx.role.findUnique({ where: { id: user.roleId } });
        for (const permission of role?.permissions ?? []) {
          granted.add(permission as Permission);
        }
      }

      // Per-user overrides win over the role in BOTH directions: a grant adds,
      // a revoke removes even when the role allows it.
      const overrides = await tx.userPermissionOverride.findMany({ where: { userId } });
      for (const override of overrides) {
        if (override.granted) granted.add(override.permission as Permission);
        else granted.delete(override.permission as Permission);
      }

      return granted;
    });
  }

  async has(userId: string, permission: Permission): Promise<boolean> {
    return (await this.resolve(userId)).has(permission);
  }
}
