import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-tenant custom domains (spec §12). A salon can point its own domain at the
 * platform; this proxy resolves the incoming host to the salon's slug and
 * rewrites `/` to `/<slug>` so one set of routes serves every tenant. (Next 16's
 * `proxy.ts` is the successor to `middleware.ts`.)
 *
 * It only acts on a bare `/` request from a genuine custom domain — our own app
 * hosts, localhost and *.vercel.app are passed straight through, as are asset,
 * API and already-pathed requests. An unmapped domain also passes through, so a
 * misconfigured domain degrades to the default rather than erroring.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const OWN_HOSTS = ['localhost', '127.0.0.1'];

export default async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (pathname !== '/') return NextResponse.next();

  const host = (request.headers.get('host') ?? '').split(':')[0];
  if (!host || OWN_HOSTS.includes(host) || host.endsWith('.vercel.app')) {
    return NextResponse.next();
  }

  try {
    const res = await fetch(`${API}/api/public/resolve?host=${encodeURIComponent(host)}`);
    if (!res.ok) return NextResponse.next();
    const { slug } = (await res.json()) as { slug?: string };
    if (slug) return NextResponse.rewrite(new URL(`/${slug}`, request.url));
  } catch {
    // API unreachable — pass through rather than 500 the salon's homepage.
  }
  return NextResponse.next();
}

export const config = {
  // Skip Next internals, the revalidate API and static assets.
  matcher: ['/((?!_next|api|favicon.ico).*)'],
};
