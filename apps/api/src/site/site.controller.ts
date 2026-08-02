import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { resolveTheme } from '@salon/shared';
import { RequiresPermission } from '../access/guards.js';
import { PrismaService } from '../prisma.service.js';
import { currentTenant } from '../tenant-context.js';
import { SiteRevalidator } from './site-revalidator.js';

const SECTION_TYPES = [
  'hero',
  'services',
  'gallery',
  'team',
  'offers',
  'testimonials',
  'hours',
  'contact',
  'cta',
] as const;

const settingsBody = z.object({
  theme: z
    .object({
      primary: z.string(),
      sidebar: z.enum(['dark', 'light']).optional(),
      radius: z.enum(['sm', 'md', 'lg']).optional(),
    })
    .optional(),
  seo: z.record(z.string(), z.unknown()).optional(),
  social: z.record(z.string(), z.unknown()).optional(),
  gaId: z.string().max(40).nullish(),
  domain: z.string().max(255).nullish(),
});

const sectionsBody = z.object({
  sections: z
    .array(
      z.object({
        id: z.uuid(),
        type: z.enum(SECTION_TYPES),
        position: z.number().int().nonnegative(),
        enabled: z.boolean(),
        data: z.record(z.string(), z.unknown()),
      }),
    )
    .max(30),
});

/**
 * The section-based landing-page CMS (spec §12). NOT a page builder — the owner
 * picks from nine fixed section types, reorders them and fills in fields. The
 * draft/publish split is provided by ISR: editing a section changes the draft,
 * and only Publish sets `publishedAt` and revalidates the public cache, so a
 * half-edited hero is never live.
 *
 * Theme is applied live (it is cosmetic and immediate), so it is not part of the
 * draft/publish cycle; it is validated for contrast before it is stored.
 */
@Controller('site')
export class SiteController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidator: SiteRevalidator,
  ) {}

  @Get('settings')
  @RequiresPermission('site.edit')
  async getSettings() {
    const { tenantId } = currentTenant();
    return this.prisma.withTenant(async (tx) => {
      const existing = await tx.siteSettings.findUnique({ where: { tenantId } });
      return existing ?? (await tx.siteSettings.create({ data: { tenantId } }));
    });
  }

  @Put('settings')
  @RequiresPermission('site.edit')
  async putSettings(@Body() raw: unknown) {
    const body = settingsBody.parse(raw);
    const { tenantId } = currentTenant();

    // Contrast is enforced here, not in the UI: resolveTheme throws on a bad hex
    // and computes the readable on-accent text colour that gets stored with it.
    const theme = body.theme ? resolveTheme(body.theme) : undefined;

    return this.prisma.withTenant((tx) =>
      tx.siteSettings.upsert({
        where: { tenantId },
        create: {
          tenantId,
          theme: (theme ?? null) as object,
          seo: (body.seo ?? null) as object,
          social: (body.social ?? null) as object,
          gaId: body.gaId ?? null,
          domain: body.domain ?? null,
        },
        update: {
          ...(theme ? { theme: theme as object } : {}),
          ...(body.seo ? { seo: body.seo as object } : {}),
          ...(body.social ? { social: body.social as object } : {}),
          ...(body.gaId !== undefined ? { gaId: body.gaId } : {}),
          ...(body.domain !== undefined ? { domain: body.domain } : {}),
          rowVersion: { increment: 1 },
        },
      }),
    );
  }

  @Get('sections')
  @RequiresPermission('site.edit')
  async getSections() {
    const { tenantId } = currentTenant();
    return this.prisma.withTenant((tx) =>
      tx.siteSection.findMany({ where: { tenantId }, orderBy: { position: 'asc' } }),
    );
  }

  /** Save the draft: upsert every section sent, delete any the owner removed. */
  @Put('sections')
  @RequiresPermission('site.edit')
  async putSections(@Body() raw: unknown) {
    const { sections } = sectionsBody.parse(raw);
    const { tenantId } = currentTenant();

    return this.prisma.withTenant(async (tx) => {
      const keepIds = sections.map((s) => s.id);
      await tx.siteSection.deleteMany({
        where: { tenantId, id: keepIds.length ? { notIn: keepIds } : undefined },
      });
      for (const s of sections) {
        await tx.siteSection.upsert({
          where: { id: s.id },
          create: {
            id: s.id,
            tenantId,
            type: s.type,
            position: s.position,
            enabled: s.enabled,
            data: s.data as object,
          },
          update: { type: s.type, position: s.position, enabled: s.enabled, data: s.data as object },
        });
      }
      return tx.siteSection.findMany({ where: { tenantId }, orderBy: { position: 'asc' } });
    });
  }

  /**
   * Publish: mark every section published as of now, then revalidate the public
   * site's ISR cache so the new content goes live in one shot. This is the step
   * that turns a draft into what a customer sees.
   */
  @Post('publish')
  @RequiresPermission('site.publish')
  async publish() {
    const { tenantId } = currentTenant();
    const slug = await this.prisma.withTenant(async (tx) => {
      await tx.siteSection.updateMany({ where: { tenantId }, data: { publishedAt: new Date() } });
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
      return tenant?.slug ?? '';
    });
    if (slug) await this.revalidator.revalidate(slug);
    return { ok: true, publishedAt: new Date().toISOString() };
  }
}
