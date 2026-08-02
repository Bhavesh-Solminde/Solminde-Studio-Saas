import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OutboxOp } from '@salon/shared';
import { PrismaService } from '../prisma.service.js';
import { currentTenant } from '../tenant-context.js';
import { EntitlementsService } from '../access/entitlements.service.js';
import { PermissionsService } from '../access/permissions.service.js';
import { OP_HANDLER, type OpHandler, type OpResult } from './op-handler.js';

export type OpOutcome =
  | { opId: string; status: 'acked'; result: OpResult; duplicate: boolean }
  | { opId: string; status: 'rejected'; reason: string };

@Injectable()
export class SyncService {
  private readonly log = new Logger(SyncService.name);
  private readonly handlers = new Map<string, OpHandler<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly permissions: PermissionsService,
    @Inject(OP_HANDLER) handlers: OpHandler<unknown>[],
  ) {
    for (const handler of handlers) {
      this.handlers.set(handler.type, handler);
    }
  }

  /**
   * Push algorithm, per op, inside ONE transaction:
   *
   *   1. Check processed_ops for op_id -> if found, return the stored result
   *   2. Look up the handler by op.type -> if unknown, reject
   *   3. Validate the payload against the handler's schema
   *   4. Check entitlements (does the salon have this feature)
   *   5. Check permissions (may this user do this)
   *   6. handler.apply(tx, ctx, payload)
   *   7. Insert into processed_ops
   *   8. Commit
   *
   * Step 1 is the one that matters most. Flaky 4G, a retry storm or a
   * double-tap all deliver the same op_id twice; without the dedupe you get
   * duplicate bills, and duplicate bills lose the client.
   */
  async push(ops: OutboxOp[]): Promise<OpOutcome[]> {
    const ctx = currentTenant();
    const outcomes: OpOutcome[] = [];

    // Ordered by localSeq so operations apply in the order the front desk
    // performed them — a redemption must not land before the top-up.
    const ordered = [...ops].sort((a, b) => a.localSeq - b.localSeq);

    for (const op of ordered) {
      try {
        outcomes.push(await this.applyOne(op, ctx));
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown error';
        this.log.warn(`Op ${op.opId} (${op.type}) rejected: ${reason}`);

        // A rejected op is recorded as an exception rather than dropped. The
        // device already applied it locally and the owner must see the
        // divergence on the Exceptions screen.
        await this.recordException(ctx.tenantId, op, reason);
        outcomes.push({ opId: op.opId, status: 'rejected', reason });
      }
    }

    return outcomes;
  }

  private async applyOne(op: OutboxOp, ctx: ReturnType<typeof currentTenant>): Promise<OpOutcome> {
    return this.prisma.withTenant(async (tx) => {
      const seen = await tx.processedOp.findUnique({ where: { opId: op.opId } });
      if (seen) {
        return {
          opId: op.opId,
          status: 'acked' as const,
          result: seen.result as OpResult,
          duplicate: true,
        };
      }

      const handler = this.handlers.get(op.type);
      if (!handler) throw new Error(`Unknown op type: ${op.type}`);

      const parsed = handler.schema.safeParse(op.payload);
      if (!parsed.success) {
        throw new Error(`Payload failed validation: ${parsed.error.message}`);
      }

      for (const feature of handler.requiredFeatures) {
        if (!(await this.entitlements.isEnabled(ctx.tenantId, feature))) {
          throw new Error(`Feature not enabled: ${feature}`);
        }
      }
      for (const permission of handler.requiredPermissions) {
        if (!(await this.permissions.has(ctx.userId, permission))) {
          throw new Error(`Missing permission: ${permission}`);
        }
      }

      const result = await handler.apply(tx, ctx, parsed.data);

      await tx.processedOp.create({
        data: { opId: op.opId, tenantId: ctx.tenantId, result: result as object },
      });

      return { opId: op.opId, status: 'acked' as const, result, duplicate: false };
    });
  }

  private async recordException(tenantId: string, op: OutboxOp, reason: string): Promise<void> {
    try {
      await this.prisma.withTenant(async (tx) => {
        await tx.syncException.create({
          data: {
            tenantId,
            type: 'op_rejected',
            detail: { opId: op.opId, opType: op.type, reason, terminalId: op.terminalId },
          },
        });
      });
    } catch (error) {
      // Never let exception-recording failure mask the original problem.
      this.log.error(`Could not record sync exception for ${op.opId}`, error);
    }
  }

  /**
   * Cursor pull. Reference data is server-authoritative and last-write-wins is
   * correct for it — the owner edits prices from one place. Transactional data
   * flows the other way and is never overwritten by the server.
   */
  async pull(since: Date | null, tables: string[]) {
    // Tenant scoping is applied by withTenant below, via RLS — not by a
    // WHERE clause here. That is the whole point of the policies.
    const cursor = since ?? new Date(0);

    return this.prisma.withTenant(async (tx) => {
      const changes: Record<string, unknown[]> = {};

      if (tables.includes('customers')) {
        changes.customers = await tx.customer.findMany({
          where: { updatedAt: { gt: cursor } },
          orderBy: { updatedAt: 'asc' },
          take: 500,
        });
      }
      if (tables.includes('services')) {
        changes.services = await tx.service.findMany({
          where: { updatedAt: { gt: cursor } },
          orderBy: { updatedAt: 'asc' },
          take: 500,
        });
      }
      if (tables.includes('products')) {
        changes.products = await tx.product.findMany({
          where: { updatedAt: { gt: cursor } },
          orderBy: { updatedAt: 'asc' },
          take: 500,
        });
      }
      if (tables.includes('staff')) {
        changes.staff = await tx.staff.findMany({
          where: { updatedAt: { gt: cursor } },
          orderBy: { updatedAt: 'asc' },
          take: 500,
        });
      }
      if (tables.includes('roles')) {
        changes.roles = await tx.role.findMany({
          where: { updatedAt: { gt: cursor } },
          orderBy: { updatedAt: 'asc' },
          take: 500,
        });
      }

      // Deletes are never hard deletes, or clients can never learn about them.
      const tombstones = await tx.tombstone.findMany({
        where: { deletedAt: { gt: cursor }, tableName: { in: tables } },
        orderBy: { deletedAt: 'asc' },
        take: 500,
      });

      return {
        changes,
        tombstones,
        cursor: new Date().toISOString(),
        serverTime: Date.now(),
      };
    });
  }
}
