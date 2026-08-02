import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { currentTenant } from './tenant-context';

/**
 * ONE PrismaClient, module-scoped, never per request.
 *
 * Connects through Supavisor in TRANSACTION mode. Statement mode must not be
 * used: it silently drops `SET LOCAL`, which would make the RLS policies below
 * stop isolating tenants with nothing visibly breaking until a client sees
 * another salon's data.
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

  /**
   * Run `fn` inside a transaction scoped to the current tenant.
   *
   * Application-layer `WHERE tenantId = ?` is not sufficient — one forgotten
   * clause and Salon A sees Salon B's customers, which is a business-ending
   * bug. Setting app.tenant_id lets Postgres RLS enforce isolation structurally.
   *
   * Stage 1 adds the RLS policies themselves and a test that proves this
   * setting survives the pooler. Until those exist this wrapper is scaffolding,
   * not protection.
   */
  async withTenant<T>(fn: (tx: PrismaTx) => Promise<T>): Promise<T> {
    const { tenantId } = currentTenant();
    return this.$transaction(async (tx) => {
      // Parameterised rather than interpolated: tenantId reaches here from a
      // request, and string-building this is a SQL injection hole.
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx as PrismaTx);
    });
  }
}

export type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
