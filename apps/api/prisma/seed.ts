import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';

// One .env at the repo root, not per app.
loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
import { randomBytes, randomUUID, scrypt as scryptCb } from 'node:crypto';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { FEATURES, PERMISSIONS } from '@salon/shared';

const scrypt = promisify(scryptCb) as (p: string, s: Buffer, k: number) => Promise<Buffer>;

async function hash(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL }),
});

/**
 * Development seed.
 *
 * TWO tenants on purpose. A single-tenant seed cannot prove tenant isolation,
 * and isolation is the thing most worth proving: a leak is business-ending and
 * nothing visibly breaks when it happens.
 *
 * Note this does not try to switch RLS off. With FORCE ROW LEVEL SECURITY the
 * table owner is subject to the policies too, and the app user on Supabase is
 * not a superuser. So the seed does what the application does — sets
 * app.tenant_id and writes inside that tenant's scope. Tenant ids are
 * generated here rather than by the database, because the policy on `tenants`
 * requires the id to be known before the row can be inserted.
 */
async function main() {
  for (const key of FEATURES) {
    // `features` is a global catalogue with no tenant dimension and no policy.
    await prisma.feature.upsert({
      where: { key },
      create: { key, label: key, category: 'core', dependsOn: [], defaultTier: 'standard' },
      update: {},
    });
  }

  const specs = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'acme-salon',
      name: 'Acme Salon',
      phone: '9000000001',
      password: 'frontdesk-dev-password',
      // Fixed catalogue ids so the billing tests can reference them directly.
      serviceId: 'aaaaaaaa-0000-4000-8000-000000000001',
      productId: 'bbbbbbbb-0000-4000-8000-000000000001',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      slug: 'rival-salon',
      name: 'Rival Salon',
      phone: '9000000002',
      password: 'rival-dev-password',
      serviceId: 'aaaaaaaa-0000-4000-8000-000000000002',
      productId: 'bbbbbbbb-0000-4000-8000-000000000002',
    },
  ];

  for (const spec of specs) {
    const passwordHash = await hash(spec.password);

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${spec.id}, true)`;

      await tx.tenant.upsert({
        where: { id: spec.id },
        create: { id: spec.id, slug: spec.slug, name: spec.name, plan: 'standard' },
        update: { name: spec.name },
      });

      const roleId = randomUUID();
      const existingRole = await tx.role.findFirst({
        where: { tenantId: spec.id, name: 'Owner' },
      });

      const role =
        existingRole ??
        (await tx.role.create({
          data: {
            id: roleId,
            tenantId: spec.id,
            name: 'Owner',
            // Owner holds everything and is never editable.
            permissions: [...PERMISSIONS],
            isSystem: true,
          },
        }));

      await tx.user.upsert({
        where: { tenantId_phone: { tenantId: spec.id, phone: spec.phone } },
        create: {
          tenantId: spec.id,
          name: `${spec.name} Owner`,
          phone: spec.phone,
          passwordHash,
          roleId: role.id,
        },
        update: { roleId: role.id },
      });

      for (const key of FEATURES) {
        await tx.tenantFeature.upsert({
          where: { tenantId_key: { tenantId: spec.id, key } },
          create: { tenantId: spec.id, key, enabled: true, source: 'plan' },
          update: { enabled: true },
        });
      }

      // A minimal catalogue so billing has something to sell. Prices are
      // integer paise (₹500 haircut, ₹300 shampoo), tax 18% GST.
      await tx.service.upsert({
        where: { id: spec.serviceId },
        create: {
          id: spec.serviceId,
          tenantId: spec.id,
          name: 'Haircut',
          durationMin: 30,
          price: 50000,
          taxRate: 18,
        },
        update: { price: 50000, taxRate: 18 },
      });

      await tx.product.upsert({
        where: { id: spec.productId },
        create: {
          id: spec.productId,
          tenantId: spec.id,
          name: 'Shampoo',
          sku: 'SHMP-250',
          cost: 15000,
          price: 30000,
          taxRate: 18,
          reorderLevel: 5,
        },
        update: { price: 30000, taxRate: 18 },
      });

      // Opening stock as a ledger entry, never a stored count. Idempotent on
      // re-seed: only laid down when the product has no stock history yet.
      const stock = await tx.stockLedger.aggregate({
        _sum: { delta: true },
        where: { productId: spec.productId },
      });
      if ((stock._sum.delta ?? 0) === 0) {
        await tx.stockLedger.create({
          data: {
            id: randomUUID(),
            tenantId: spec.id,
            productId: spec.productId,
            delta: 50,
            reason: 'opening',
            terminalId: '00000000-0000-4000-8000-0000000000ff',
            opId: randomUUID(),
          },
        });
      }
    });

    console.log(`Seeded ${spec.slug} — login ${spec.phone} / ${spec.password}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
