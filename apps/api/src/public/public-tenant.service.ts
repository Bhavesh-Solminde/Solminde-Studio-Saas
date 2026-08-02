import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { tenantStorage } from '../tenant-context.js';

interface PublicTenantRow {
  tenant_id: string;
  name: string;
  timezone: string;
  status: string;
}

/**
 * Resolves a salon from its public slug and runs work inside its tenant scope,
 * for the unauthenticated public surfaces (online booking, the public site).
 *
 * The slug lookup goes through the `app_public_tenant` SECURITY DEFINER function
 * — the same fail-closed pattern as login — because RLS returns nothing without
 * a tenant context and these routes have no login to establish one. Everything
 * after resolution runs under `tenantStorage.run` with an empty user id, so the
 * usual RLS-scoped `withTenant` queries just work.
 */
@Injectable()
export class PublicTenantService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(slug: string): Promise<{ tenantId: string; name: string; timezone: string }> {
    const rows = await this.prisma.$queryRaw<PublicTenantRow[]>`
      SELECT * FROM app_public_tenant(${slug})
    `;
    const found = rows[0];
    if (!found || found.status !== 'active') throw new NotFoundException('Salon not found');
    return { tenantId: found.tenant_id, name: found.name, timezone: found.timezone };
  }

  run<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return tenantStorage.run({ tenantId, userId: '', role: 'public' }, fn);
  }
}
