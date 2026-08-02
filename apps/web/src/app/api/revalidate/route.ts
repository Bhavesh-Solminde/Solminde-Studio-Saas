import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

/**
 * On-demand ISR revalidation, called by the API's SiteRevalidator when an owner
 * hits Publish. It refreshes exactly the tenant's cached site — `tenant-<slug>`
 * — so a publish goes live in one shot rather than waiting for the time-based
 * revalidation window. Guarded by a shared secret so it cannot be triggered by
 * anyone who guesses the route.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const tag = url.searchParams.get('tag');
  const secret = url.searchParams.get('secret');

  const expected = process.env.WEB_REVALIDATE_SECRET;
  if (expected && secret !== expected) {
    return NextResponse.json({ ok: false, error: 'bad secret' }, { status: 401 });
  }
  if (!tag) {
    return NextResponse.json({ ok: false, error: 'missing tag' }, { status: 400 });
  }

  // The tag is `tenant-<slug>`; the salon's site lives at `/<slug>`.
  const slug = tag.replace(/^tenant-/, '');
  revalidatePath(`/${slug}`);
  return NextResponse.json({ ok: true, revalidated: slug });
}
