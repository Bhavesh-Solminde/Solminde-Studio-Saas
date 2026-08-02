import { notFound } from 'next/navigation';
import type { CSSProperties } from 'react';

/**
 * The one salon site template (spec §12), rendered per-tenant from published
 * sections + live admin data. Built from the pattern report in
 * scripts/design-research/: spare and photo-forward, one CTA per block, a single
 * tenant accent used sparingly, a sticky Book affordance on mobile. It should
 * read as *a salon site* without resembling any single reference.
 *
 * Draft/publish is enforced upstream — the API returns only published sections —
 * and ISR keeps the render cached until Publish revalidates the slug tag.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface SiteData {
  salon: { name: string; slug: string };
  settings: { theme?: Theme; seo?: Record<string, unknown>; social?: Record<string, unknown> } | null;
  sections: { id: string; type: string; data: Record<string, unknown> }[];
  live: {
    services: { id: string; name: string; durationMin: number; price: number }[];
    team: { id: string; displayName: string; skills: string[] }[];
  };
}
interface Theme {
  primary: string;
  onPrimary: string;
  sidebar?: string;
  radius?: string;
}

async function getSite(slug: string): Promise<SiteData | null> {
  // ISR: cached for 5 min, and revalidated on demand at /<slug> the instant the
  // owner hits Publish (see the /api/revalidate route and the API's revalidator).
  const res = await fetch(`${API}/api/public/${slug}/site`, {
    next: { revalidate: 300 },
  });
  if (!res.ok) return null;
  return res.json();
}

export default async function SitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = await getSite(slug);
  if (!site) notFound();

  const theme = site.settings?.theme;
  const accent = theme?.primary ?? '#0f5da8';
  const onAccent = theme?.onPrimary ?? '#ffffff';
  const rootStyle = {
    '--accent': accent,
    '--on-accent': onAccent,
  } as CSSProperties;

  const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

  return (
    <div style={{ ...rootStyle, ...t.page }}>
      <header style={t.nav}>
        <span style={t.wordmark}>{site.salon.name}</span>
        <a href={`/book/${slug}`} style={t.navCta}>
          Book now
        </a>
      </header>

      {site.sections.length === 0 && (
        <section style={t.empty}>
          <p>This site has not been published yet.</p>
        </section>
      )}

      {site.sections.map((section) => {
        const d = section.data;
        switch (section.type) {
          case 'hero':
            return (
              <section key={section.id} style={heroStyle(str(d.image))}>
                <div style={t.heroInner}>
                  <h1 style={t.heroHead}>{str(d.headline, 'Look and feel your best')}</h1>
                  {str(d.subhead) && <p style={t.heroSub}>{str(d.subhead)}</p>}
                  <a href={`/book/${slug}`} style={t.heroCta}>
                    {str(d.cta, 'Book an appointment')}
                  </a>
                </div>
              </section>
            );
          case 'services':
            return (
              <section key={section.id} style={t.section}>
                <h2 style={t.h2}>{str(d.heading, 'Services')}</h2>
                <div style={t.grid}>
                  {site.live.services.map((svc) => (
                    <div key={svc.id} style={t.card}>
                      <span style={t.cardTitle}>{svc.name}</span>
                      <span style={t.cardMeta}>{svc.durationMin} min</span>
                      <span style={t.cardPrice}>₹{(svc.price / 100).toLocaleString('en-IN')}</span>
                    </div>
                  ))}
                </div>
              </section>
            );
          case 'team':
            return (
              <section key={section.id} style={t.section}>
                <h2 style={t.h2}>{str(d.heading, 'Our team')}</h2>
                <div style={t.grid}>
                  {site.live.team.map((member) => (
                    <div key={member.id} style={t.card}>
                      <span style={t.cardTitle}>{member.displayName}</span>
                      <span style={t.cardMeta}>{(member.skills ?? []).join(', ')}</span>
                    </div>
                  ))}
                </div>
              </section>
            );
          case 'testimonials':
            return (
              <section key={section.id} style={{ ...t.section, ...t.tint }}>
                <h2 style={t.h2}>{str(d.heading, 'What our clients say')}</h2>
                <blockquote style={t.quote}>{str(d.quote, '“The best in the city.”')}</blockquote>
              </section>
            );
          case 'hours':
            return (
              <section key={section.id} style={t.section}>
                <h2 style={t.h2}>{str(d.heading, 'Opening hours')}</h2>
                <p style={t.para}>{str(d.hours, 'Mon–Sun, 10:00–20:00')}</p>
              </section>
            );
          case 'contact':
            return (
              <section key={section.id} style={{ ...t.section, ...t.tint }}>
                <h2 style={t.h2}>{str(d.heading, 'Visit us')}</h2>
                <p style={t.para}>{str(d.address)}</p>
                <p style={t.para}>{str(d.phone)}</p>
              </section>
            );
          case 'cta':
            return (
              <section key={section.id} style={t.ctaBand}>
                <h2 style={{ ...t.h2, color: 'var(--on-accent)' }}>{str(d.heading, 'Ready?')}</h2>
                <a href={`/book/${slug}`} style={t.ctaBandBtn}>
                  {str(d.cta, 'Book now')}
                </a>
              </section>
            );
          default:
            return (
              <section key={section.id} style={t.section}>
                <h2 style={t.h2}>{str(d.heading, section.type)}</h2>
                {str(d.body) && <p style={t.para}>{str(d.body)}</p>}
              </section>
            );
        }
      })}

      <footer style={t.footer}>
        <span>{site.salon.name}</span>
        <a href={`/book/${slug}`} style={{ color: 'var(--accent)' }}>
          Book an appointment
        </a>
      </footer>

      {/* Sticky Book bar — the mobile convention every reference site uses. */}
      <a href={`/book/${slug}`} style={t.stickyBook}>
        Book now
      </a>
    </div>
  );
}

function heroStyle(image: string): CSSProperties {
  return {
    ...t.hero,
    backgroundImage: image
      ? `linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.45)), url(${image})`
      : 'linear-gradient(135deg, #1a1d21, #333)',
  };
}

const t: Record<string, CSSProperties> = {
  page: { fontFamily: 'Georgia, "Times New Roman", serif', color: '#1a1d21', background: '#fff' },
  nav: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '18px 28px',
    borderBottom: '1px solid #ececec',
    position: 'sticky',
    top: 0,
    background: '#fff',
    zIndex: 10,
  },
  wordmark: { fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em' },
  navCta: {
    padding: '9px 16px',
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    textDecoration: 'none',
    fontSize: 14,
    fontFamily: 'system-ui, sans-serif',
    fontWeight: 600,
    borderRadius: 4,
  },
  hero: {
    minHeight: '68vh',
    display: 'flex',
    alignItems: 'flex-end',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    color: '#fff',
  },
  heroInner: { padding: '48px 28px', maxWidth: 720 },
  heroHead: { fontSize: 46, lineHeight: 1.05, margin: '0 0 14px', letterSpacing: '-0.02em' },
  heroSub: { fontSize: 18, margin: '0 0 22px', fontFamily: 'system-ui, sans-serif', opacity: 0.92 },
  heroCta: {
    display: 'inline-block',
    padding: '13px 24px',
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    textDecoration: 'none',
    fontFamily: 'system-ui, sans-serif',
    fontWeight: 600,
    borderRadius: 4,
  },
  section: { padding: '64px 28px', maxWidth: 1040, margin: '0 auto' },
  tint: { background: '#faf8f5', maxWidth: 'none' },
  h2: { fontSize: 30, margin: '0 0 28px', letterSpacing: '-0.02em' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: 20,
    border: '1px solid #ececec',
    borderRadius: 8,
    fontFamily: 'system-ui, sans-serif',
  },
  cardTitle: { fontSize: 17, fontWeight: 600, fontFamily: 'Georgia, serif' },
  cardMeta: { fontSize: 13, color: '#6b7280' },
  cardPrice: { fontSize: 15, fontWeight: 600, color: 'var(--accent)' },
  para: { fontSize: 16, lineHeight: 1.7, fontFamily: 'system-ui, sans-serif', color: '#374151' },
  quote: { fontSize: 24, fontStyle: 'italic', lineHeight: 1.5, margin: 0, maxWidth: 720 },
  ctaBand: { padding: '56px 28px', background: 'var(--accent)', textAlign: 'center' },
  ctaBandBtn: {
    display: 'inline-block',
    marginTop: 8,
    padding: '13px 26px',
    background: '#fff',
    color: 'var(--accent)',
    textDecoration: 'none',
    fontFamily: 'system-ui, sans-serif',
    fontWeight: 700,
    borderRadius: 4,
  },
  empty: { padding: '80px 28px', textAlign: 'center', color: '#6b7280' },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '28px',
    borderTop: '1px solid #ececec',
    fontFamily: 'system-ui, sans-serif',
    fontSize: 14,
  },
  stickyBook: {
    position: 'fixed',
    bottom: 16,
    left: 16,
    right: 16,
    padding: '15px',
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    textAlign: 'center',
    textDecoration: 'none',
    fontFamily: 'system-ui, sans-serif',
    fontWeight: 700,
    borderRadius: 8,
    boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
  },
};
