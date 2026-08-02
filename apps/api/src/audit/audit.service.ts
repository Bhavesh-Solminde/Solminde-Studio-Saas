import { Injectable } from '@nestjs/common';
import type { PrismaTx } from '../prisma.service.js';
import type { TenantCtx } from '../tenant-context.js';

/**
 * The audit log for money, stock and permission changes.
 *
 * Definition of Done: anything that touches money, stock or permissions must be
 * visible in the audit log. Entries are written on the SAME transaction as the
 * change they describe, so a committed bill and its audit row are atomic — there
 * is no window where one exists without the other.
 */
@Injectable()
export class AuditService {
  async record(
    tx: PrismaTx,
    ctx: TenantCtx,
    entry: {
      action: string;
      entity: string;
      entityId?: string;
      before?: unknown;
      after?: unknown;
    },
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        before: (entry.before ?? null) as object,
        after: (entry.after ?? null) as object,
      },
    });
  }
}
