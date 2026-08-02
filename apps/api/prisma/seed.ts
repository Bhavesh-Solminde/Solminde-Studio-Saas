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
      resourceId: '99999999-0000-4000-8000-000000000001',
      // Stage 3: two stylists on DIFFERENT commission rules, so a test can bill
      // the same service under each and prove the numbers stay separate.
      ruleAId: 'cccccccc-0000-4000-8000-000000000001',
      ruleBId: 'cccccccc-0000-4000-8000-000000000002',
      staffAId: 'dddddddd-0000-4000-8000-000000000001',
      staffBId: 'dddddddd-0000-4000-8000-000000000002',
      stylistAPhone: '9000000010',
      stylistBPhone: '9000000011',
      packageId: 'eeeeeeee-0000-4000-8000-000000000001',
      membershipId: 'ffffffff-0000-4000-8000-000000000001',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      slug: 'rival-salon',
      name: 'Rival Salon',
      phone: '9000000002',
      password: 'rival-dev-password',
      serviceId: 'aaaaaaaa-0000-4000-8000-000000000002',
      productId: 'bbbbbbbb-0000-4000-8000-000000000002',
      resourceId: '99999999-0000-4000-8000-000000000002',
      ruleAId: 'cccccccc-0000-4000-8000-000000000003',
      ruleBId: 'cccccccc-0000-4000-8000-000000000004',
      staffAId: 'dddddddd-0000-4000-8000-000000000003',
      staffBId: 'dddddddd-0000-4000-8000-000000000004',
      stylistAPhone: '9000000020',
      stylistBPhone: '9000000021',
      packageId: 'eeeeeeee-0000-4000-8000-000000000002',
      membershipId: 'ffffffff-0000-4000-8000-000000000002',
    },
  ];

  // Stylists log in with one shared dev password; the point of the seed is the
  // two different commission rules, not credential variety.
  const stylistPassword = 'stylist-dev-password';
  const stylistHash = await hash(stylistPassword);

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

      // Two flat commission rules on different service rates: 30% and 40%.
      await tx.commissionRule.upsert({
        where: { id: spec.ruleAId },
        create: {
          id: spec.ruleAId,
          tenantId: spec.id,
          name: 'Junior — 30% service',
          kind: 'flat',
          serviceRate: 30,
          retailRate: 10,
        },
        update: { serviceRate: 30, retailRate: 10 },
      });
      await tx.commissionRule.upsert({
        where: { id: spec.ruleBId },
        create: {
          id: spec.ruleBId,
          tenantId: spec.id,
          name: 'Senior — 40% service',
          kind: 'flat',
          serviceRate: 40,
          retailRate: 15,
        },
        update: { serviceRate: 40, retailRate: 15 },
      });

      // A Stylist role: can bill and see OWN commission, but never everyone's.
      // commission.view_all is the permission that starts salon-floor fights.
      const stylistRole =
        (await tx.role.findFirst({ where: { tenantId: spec.id, name: 'Stylist' } })) ??
        (await tx.role.create({
          data: {
            id: randomUUID(),
            tenantId: spec.id,
            name: 'Stylist',
            permissions: ['bill.create', 'customer.view', 'commission.view_own'],
            isSystem: true,
          },
        }));

      // Two stylist users, each linked to a staff record on a different rule.
      const stylists = [
        { phone: spec.stylistAPhone, staffId: spec.staffAId, ruleId: spec.ruleAId, name: 'Asha' },
        { phone: spec.stylistBPhone, staffId: spec.staffBId, ruleId: spec.ruleBId, name: 'Bhavna' },
      ];
      for (const stylist of stylists) {
        const user = await tx.user.upsert({
          where: { tenantId_phone: { tenantId: spec.id, phone: stylist.phone } },
          create: {
            tenantId: spec.id,
            name: stylist.name,
            phone: stylist.phone,
            passwordHash: stylistHash,
            roleId: stylistRole.id,
          },
          update: { roleId: stylistRole.id },
        });
        await tx.staff.upsert({
          where: { id: stylist.staffId },
          create: {
            id: stylist.staffId,
            tenantId: spec.id,
            userId: user.id,
            displayName: stylist.name,
            commissionRuleId: stylist.ruleId,
          },
          update: { userId: user.id, commissionRuleId: stylist.ruleId },
        });
      }

      // A prepaid package (5 haircuts, valid 180 days) on the session ledger,
      // and a membership that credits the wallet on purchase.
      await tx.package.upsert({
        where: { id: spec.packageId },
        create: {
          id: spec.packageId,
          tenantId: spec.id,
          name: '5 Haircuts',
          price: 200000,
          validityDays: 180,
        },
        update: { price: 200000 },
      });
      await tx.packageItem.upsert({
        where: { packageId_serviceId: { packageId: spec.packageId, serviceId: spec.serviceId } },
        create: {
          tenantId: spec.id,
          packageId: spec.packageId,
          serviceId: spec.serviceId,
          quantity: 5,
        },
        update: { quantity: 5 },
      });
      await tx.membership.upsert({
        where: { id: spec.membershipId },
        create: {
          id: spec.membershipId,
          tenantId: spec.id,
          name: 'Gold',
          price: 500000,
          walletCredit: 600000,
        },
        update: { walletCredit: 600000 },
      });

      // A bookable resource (styling chair) for appointment conflict checking.
      await tx.resource.upsert({
        where: { id: spec.resourceId },
        create: { id: spec.resourceId, tenantId: spec.id, name: 'Chair 1', type: 'chair' },
        update: { name: 'Chair 1' },
      });
    });

    console.log(`Seeded ${spec.slug} — login ${spec.phone} / ${spec.password}`);
    console.log(`  stylists ${spec.stylistAPhone} & ${spec.stylistBPhone} / ${stylistPassword}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
