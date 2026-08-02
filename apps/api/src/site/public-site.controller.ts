import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { PublicTenantService } from '../public/public-tenant.service.js';

/**
 * What the public Next.js site renders: the tenant's theme and SEO, its
 * published sections, and the live data (services, team) that the live-data
 * section types draw from. Unauthenticated and resolved by slug, like booking.
 *
 * Only PUBLISHED, enabled sections are returned — the draft/publish split. A
 * section the owner is still editing has no `publishedAt` and does not appear
 * here until Publish, so a half-edited hero is never served to a customer.
 */
@Controller('public')
export class PublicSiteController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publicTenant: PublicTenantService,
  ) {}

  /**
   * Resolve a custom domain to a salon slug, for the Next.js middleware that
   * rewrites `salon-domain.com` to that tenant's site. Returns 404 for an
   * unmapped host so the middleware simply passes the request through.
   */
  @Get('resolve')
  async resolve(@Query('host') host: string) {
    if (!host) throw new NotFoundException('No host');
    const rows = await this.prisma.$queryRaw<{ slug: string }[]>`
      SELECT * FROM app_slug_by_domain(${host})
    `;
    const found = rows[0];
    if (!found) throw new NotFoundException('No salon for that domain');
    return { slug: found.slug };
  }

  @Get(':slug/site')
  async site(@Param('slug') slug: string) {
    const tenant = await this.publicTenant.resolve(slug);
    return this.publicTenant.run(tenant.tenantId, () =>
      this.prisma.withTenant(async (tx) => {
        const [settings, sections, services, team] = await Promise.all([
          tx.siteSettings.findUnique({ where: { tenantId: tenant.tenantId } }),
          tx.siteSection.findMany({
            where: { enabled: true, publishedAt: { not: null } },
            orderBy: { position: 'asc' },
          }),
          tx.service.findMany({
            where: { active: true },
            select: { id: true, name: true, durationMin: true, price: true },
            orderBy: { name: 'asc' },
          }),
          tx.staff.findMany({ select: { id: true, displayName: true, skills: true } }),
        ]);

        return {
          salon: { name: tenant.name, slug },
          settings,
          sections,
          live: { services, team },
        };
      }),
    );
  }
}
