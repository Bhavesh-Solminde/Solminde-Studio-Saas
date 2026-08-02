# Salon site — pattern report

Evidence-based input for the one landing-page template (spec §12, step 3). Drawn
from a Playwright capture of 15 reference sites at desktop (1440) and mobile
(390): premium Indian salon chains (Naturals, Lakmé, BBLUNT, Looks, Jean-Claude
Biguine), international salon/spa (Aveda, Paul Mitchell, Toni & Guy, Rush,
Sassoon), and adjacent verticals with the same job-to-be-done (Equinox, Barry's,
ClassPass, Tend, Mindbody).

Screenshots are internal analysis only — gitignored, never shipped, never shown
to clients. This report records **conventions**, not any one site's execution.
A few sites (Drybar) served a bot wall; they were excluded from analysis.

## Convergent patterns (follow these — they are the category's vocabulary)

| Dimension | What the set converges on | Template decision |
|---|---|---|
| **Section order** | Hero → services → social proof/trust → gallery → offers → contact/map. Booking CTA is always above the fold and repeated. | Ship exactly this default order for the nine section types. |
| **Hero** | Full-bleed photo (or promo banner on Indian chains), one short display headline, one primary CTA. Indian sites overlay a promo/offer; premium sites use pure photography + minimal type. | Full-bleed hero, one headline, one "Book now" CTA. Photo is tenant-supplied. |
| **Booking entry points** | Multiple: a top-nav button ("Book"/"Visit"/"Join Today"), an in-hero CTA, and — on every Indian site — a **sticky floating WhatsApp + Book bar**. | Persistent top-nav Book button + sticky mobile Book/WhatsApp bar. |
| **Social proof** | Testimonials carousel mid-page; trust badges near the hero (Naturals: "25 Years", "1000+ Salons"). | Testimonials section + a small trust-stat strip under the hero. |
| **Photo-to-text ratio** | Heavily visual; premium sites are ~80% imagery with terse copy and a single CTA link per block. | Large imagery, short copy, one CTA per section. Never a wall of text. |
| **Typography** | Display serif or bold grotesk for headlines, clean sans for body; large size scale; short line lengths. | One display face + one body sans, generous scale (matches DESIGN.md). |
| **Colour** | Mostly neutral canvas with accent spent on CTAs and section dividers; Indian chains lean harder on a single brand hue (Naturals purple). | Neutral canvas, single tenant accent on CTAs/dividers — exactly the theming model already built. |
| **Mobile** | Hamburger nav; hero and sections stack; **sticky call/WhatsApp/Book bar** at the bottom; large tap targets. | Mobile-first stacking, hamburger, sticky bottom Book bar. |
| **Trust signals** | Address, phone, hours, map and socials in a dense footer; store/locator prominent for chains. | Footer with address, phone, hours, socials; contact section with map embed slot. |

## Divergent — where the design decision lives

- **Hero treatment:** promo-banner (Indian, conversion-led) vs pure-photography
  (premium, brand-led). **Choice:** pure photography with an optional offer
  ribbon, so one template serves both — the tenant's photos and copy decide the
  feel.
- **Density:** Indian chains are dense and multi-section; premium sites are
  spare. **Choice:** spare by default (fewer, taller sections), because emptiness
  reads as premium and the owner adds sections only as they have content.
- **Accent intensity:** heavy single-hue vs restrained. **Choice:** restrained —
  accent on CTAs and dividers only; the contrast-enforced theme keeps it legible.

## What this means for the template

Nine section types (hero, services, gallery, team, offers, testimonials, hours,
contact, cta), spare premium layout, one tenant accent used sparingly, a sticky
Book affordance on mobile, and live-data sections (services, team, hours) pulled
straight from admin data so the site is never stale. It should read as *a salon
site* — belonging to the category — without resembling any single reference in
the set.
