import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { currentTenant } from './tenant-context.js';

export type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * The transaction currently in scope, if any.
 *
 * Every service wraps its own queries in withTenant so it is RLS-safe wherever
 * it is called from. Without this, a service called from inside another
 * service's transaction would open a NESTED transaction, which Prisma does not
 * support. Carrying the active tx here means the inner call transparently
 * joins the outer one instead.
 */
const activeTx = new AsyncLocalStorage<PrismaTx>();

/**
 * ONE PrismaClient, module-scoped, never per request.
 *
 * Connects as `salon_app` through Supavisor in TRANSACTION mode.
 *
 * Two things that must not change without understanding why:
 *
 * 1. NOT the `postgres` role. Supabase's postgres role has rolbypassrls=true,
 *    which silently disables every RLS policy — tenant isolation stops working
 *    and nothing visibly breaks until a client sees another salon's data.
 *
 * 2. Transaction mode, not statement mode. Statement mode does not keep a
 *    connection for the length of a transaction, so the set_config below would
 *    not apply to the statements that follow it.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Run `fn` in a transaction scoped to the tenant in the current request. */
  async withTenant<T>(fn: (tx: PrismaTx) => Promise<T>): Promise<T> {
    return this.withTenantId(currentTenant().tenantId, fn);
  }

  /**
   * Same, for paths that know the tenant before AsyncLocalStorage does —
   * login and refresh, which establish the context rather than consume it.
   */
  async withTenantId<T>(tenantId: string, fn: (tx: PrismaTx) => Promise<T>): Promise<T> {
    const existing = activeTx.getStore();
    if (existing) return fn(existing);

    return this.$transaction(async (tx) => {
      // Parameterised, not interpolated: tenantId arrives from a request and
      // string-building it would be a SQL injection hole.
      //
      // The third argument `true` makes the setting transaction-local, so a
      // pooled connection cannot carry one tenant's id into the next request
      // that borrows the same backend.
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return activeTx.run(tx as PrismaTx, () => fn(tx as PrismaTx));
    });
  }
}
