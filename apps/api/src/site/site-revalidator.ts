import { Injectable, Logger } from '@nestjs/common';

/**
 * Triggers ISR revalidation of a tenant's public site after Publish.
 *
 * The public site lives on Vercel (Next.js), a separate origin, so publishing
 * hits its revalidate webhook with a shared secret. The webhook calls
 * `revalidateTag('tenant-' + id)`. That tag is what gives draft/publish its
 * teeth: edits sit in the draft until this call refreshes the cache in one shot.
 *
 * Config-driven and safe when unset: with no `WEB_REVALIDATE_URL` (local dev,
 * where Next serves fresh anyway) it is a logged no-op, so publishing never
 * fails just because the webhook is not wired.
 */
@Injectable()
export class SiteRevalidator {
  private readonly log = new Logger(SiteRevalidator.name);

  async revalidate(slug: string): Promise<void> {
    const base = process.env.WEB_REVALIDATE_URL;
    const secret = process.env.WEB_REVALIDATE_SECRET;
    if (!base) {
      this.log.log(`Publish for ${slug}: no WEB_REVALIDATE_URL set, skipping revalidation.`);
      return;
    }
    try {
      const url = new URL(base);
      // Tag by slug, which is what the public page knows to tag its own fetch.
      url.searchParams.set('tag', `tenant-${slug}`);
      if (secret) url.searchParams.set('secret', secret);
      await fetch(url, { method: 'POST' });
    } catch (error) {
      // A failed revalidation must not fail the publish — the content is saved;
      // the cache simply refreshes on its next scheduled pass.
      this.log.warn(`Revalidation webhook failed for ${slug}: ${String(error)}`);
    }
  }
}
