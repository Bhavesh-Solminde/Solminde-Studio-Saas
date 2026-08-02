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
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return new Set();

    const granted = new Set<Permission>();

    if (user.roleId) {
      const role = await this.prisma.role.findUnique({ where: { id: user.roleId } });
      for (const permission of role?.permissions ?? []) {
        granted.add(permission as Permission);
      }
    }

    // Per-user overrides win over the role in both directions: a grant adds,
    // a revoke removes even when the role allows it.
    const overrides = await this.prisma.userPermissionOverride.findMany({ where: { userId } });
    for (const override of overrides) {
      if (override.granted) granted.add(override.permission as Permission);
      else granted.delete(override.permission as Permission);
    }

    return granted;
  }

  async has(userId: string, permission: Permission): Promise<boolean> {
    return (await this.resolve(userId)).has(permission);
  }
}
