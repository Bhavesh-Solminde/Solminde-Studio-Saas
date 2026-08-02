<!-- SEED: established with the user before implementation; re-run /impeccable document once there's code to capture the actual tokens and components. -->

---
name: Salon Platform
description: A signal-grade operating surface for salon front desks — greyed-white ground, blue for settled, yellow for waiting, and nothing else coloured.
---

# Design System: Salon Platform

## Overview

**Creative North Star: "The Signal Desk"**

This is an interface built to be read correctly at a glance, by a tired person, under
pressure, with a customer standing in front of them. It borrows its discipline from the
surfaces people already trust with consequences — transit information boards, aviation
displays, industrial control panels — where colour is never decoration and always state.
The professionalism is not a veneer of polish; it is the visible fact that nothing on
screen is there for effect.

The system runs on a greyed-white ground with exactly two signal colours. **Blue means
settled. Yellow means waiting on you.** That pair is not chosen for taste — it is the
product's own mechanism made visible. This is an offline-first system whose defining
question, all day, is *has this reached the server yet?* Blue and yellow answer it without
being read, and they remain distinguishable to the roughly one in twelve men with colour
vision deficiency, which red and green would not.

Calm here comes from restraint, not from softness. Generous rhythm, a flat field, hairline
separation instead of floating cards and shadow stacks, and figures that line up in real
tabular numerals. On a 4 GB i3 at 1366×768 — the actual hardware — flatness is also the
fastest thing to paint. Warmth comes from the ink being a warm near-black rather than pure
black, from real breathing room around dense tables, and from language that speaks plainly.
This surface is never branded with the salon's own identity; the tenant's colour belongs to
their public website and one small identity strip, and nowhere else.

Two constraints govern how this gets built, and they pull in the same direction.

**It must be easy, not merely efficient.** The front desk turns over, and we onboard each
salon by hand — ease of use is a commercial position, not a nicety. Density here means not
wasting space; it never means putting more decisions in front of a person. Every screen does
one obvious thing, the common path is the default path, and rare options stay folded away
until asked for. A new hire should be billing confidently on day one without a manual. If a
screen needs explaining, the screen is wrong, not the person.

**It must not look like software a machine designed.** The tells are specific and known:
violet and indigo gradients, gradient text, glowing accents on dark, left-edge accent bars
on cards, cards nested inside cards, three-up icon-circle grids, emoji standing in for
icons, every gap the same size, every element centred, one type size doing every job. This
system refuses them by construction, and the project's detector (`npx impeccable detect`)
runs on every UI change to catch the rest. The positive version of the rule: this should
look like it was made by someone who has actually stood behind a salon counter.

**Key Characteristics:**

- Two signal colours, each with one fixed meaning, applied nowhere decoratively
- Greyed-white field, flat, separated by hairline rules rather than shadow
- Tabular figures on every number that represents money or quantity
- Efficient with space, generous with clarity — a working screen, not a marketing screen
- One obvious action per screen; complexity is disclosed, never presented
- Product chrome is fixed; tenant identity never enters it
- Colour-blind safe and AA-compliant by construction, not by later audit

## Colors

A near-neutral field carrying two signals and one alarm. The palette is deliberately small:
every additional hue would dilute the only thing colour is allowed to say here.

### Primary

- **Signal Blue** (`#0F5DA8`): the settled state and the primary action. Save, confirm,
  commit, synced. Used on the primary button, the active navigation state, and every
  indicator meaning *this has reached the server and is safe*. Carries white text at roughly
  7:1 contrast.
- **Blue Wash** (`#E8F0FA`): the tint behind selected rows, the active sidebar item, and
  informational panels. Never used for text.

### Secondary

- **Signal Yellow** (`#F2B705`): the waiting state and everything that needs a human.
  Pending sync, queued operations, low stock, an invoice block running out, a bill awaiting
  payment. Also the secondary action. **Always carries near-black ink, never white** — see
  the Never Whispers Rule.
- **Yellow Wash** (`#FDF3D6`): the tint behind rows in a pending or attention state, and the
  ground of the offline banner.

### Tertiary

- **Alarm Red** (`#B3261E`): reserved for the genuinely exceptional — a voided bill, a
  wallet gone negative, a detected overdraft, a destructive confirmation. Rare by design; if
  red is common on a screen, the screen is wrong.

### Neutral

- **Field Grey-White** (`#F3F5F7`): the application ground. The greyed white that gives
  white panels something to sit against without needing a shadow to do it.
- **Panel White** (`#FFFFFF`): working surfaces — tables, the bill composer, forms.
- **Warm Ink** (`#1A1D21`): all primary text, and the ink on yellow. A warm near-black
  rather than pure `#000`, which is harsh on a cheap panel across a nine-hour shift.
- **Muted Ink** (`#5A626B`): labels, secondary text, column headers, timestamps.
- **Hairline** (`#D9DEE3`): every rule, border and table separator in the system.

### Tenant Accent

- **`--tenant-primary`** (variable): the salon's own colour, derived to a full scale in
  OKLCH from a single owner-chosen value. It appears on their **public website only**, plus
  one identity strip carrying their logo and name. It never touches a control, a status, a
  table, or any chrome in the POS.

### Named Rules

**The Two-Signal Rule.** Blue means settled. Yellow means waiting on you. Red means
something went wrong. Nothing else on this surface is coloured — not a category, not a
chart series, not a decorative header. If a new thing needs a colour, it needs a reason
first, and the reason is almost never real.

**The Never Whispers Rule.** Signal Yellow always carries Warm Ink, never white. Yellow with
white text is the most common contrast failure in interface design and it fails on exactly
the surface that most needs to be read — the one telling the front desk something is
pending.

**The Chrome Is Never Branded Rule.** The tenant's colour has two homes: their public site
and their identity strip. A salon owner cannot recolour a Save button, a status pill, or a
table. This is what makes one screenshot legible across every install and what keeps a badly
chosen brand colour from making money unreadable.

## Typography

**Display / UI Font:** `[to be resolved during implementation]` — a calm contemporary
grotesk or humanist sans with a genuine tabular-figure set and a usable all-caps or
small-caps label cut. Chosen for legibility at small sizes on a low-quality 1366×768 panel,
not for personality.

**Numeric:** the same family's tabular figures. A separate mono is introduced only if the
chosen family's tabular set proves inadequate.

**Character:** plain, quiet and highly legible. No display face, no editorial serif, no
personality in the type — the type's job here is to disappear so the numbers can be trusted.
Excluded by policy as over-defaulted: Inter-as-display, Roboto, DM Sans, Plus Jakarta Sans,
Outfit, Space Grotesk, Poppins.

### Hierarchy

- **Screen Title** — one per screen, states where you are. Never decorative scale.
- **Section Header** — small, in Muted Ink, often uppercase with tracking. Labels a region.
- **Body** — the default reading size, generous enough for sustained use.
- **Data** — table cells and figures. Tabular numerals, hard-right for anything numeric.
- **Total** — the one place type is allowed to be large. The bill total is the most
  important number on the busiest screen and it is sized to prove it.
- **Label / Meta** — timestamps, terminal identifiers, invoice series, version badge.

Exact sizes, weights and line heights are `[to be resolved during implementation]`.

### Named Rules

**The Tabular Rule.** Every number representing money, quantity or a count is set in tabular
figures and right-aligned. Proportional figures make currency columns ragged, and a ragged
money column reads as carelessness in a product whose entire claim is that money is never
wrong.

**The Total Earns Its Size.** Exactly one number per screen may be large. On the billing
screen it is the total. Making a second number large costs the first one its meaning.

## Layout

A dense working grid built for 1366×768 as the design target, not as a degraded case. The
POS is an **Operate** surface: scanability, consistent placement and predictable affordances
outrank expression everywhere. The public site templates are **Persuade** and carry a
different, more generous rhythm — the same system, a different register.

Structure is a persistent left navigation rail, a fixed header band, and a working area.
Positions never move between screens; the front desk must be able to reach a control without
looking for it.

**The header band holds permanent space for connection state.** The offline indicator and
pending-operation count occupy a reserved well whether or not anything is wrong, so their
appearance never reflows the billing screen mid-transaction. A layout that jumps when the
internet drops is a layout that punishes the exact moment this product exists for.

Efficient use of space comes from removing padding inflation and nested containers, not from
shrinking type and not from adding more to the screen. Tables tile edge to edge inside their
region and separate with hairlines. Responsive behaviour matters least here — this is a
desktop counter tool — but nothing may overflow the viewport horizontally.

**Spacing must not be monotonous.** A single repeated gap between every element is one of
the clearest signs of a machine-assembled layout, and it also destroys grouping: things that
belong together should sit closer than things that don't. The scale needs real steps, and
headings take more space above than below.

Exact grid, container and spacing-scale values are `[to be resolved during implementation]`.

### Named Rules

**The One Obvious Action Rule.** Every screen has a single primary action, rendered in Signal
Blue, in a predictable place. Secondary actions are quieter; rare and destructive ones live
behind a menu or a confirmation. A screen presenting two equally-weighted primary buttons has
not decided what it is for, and the front desk pays for that indecision at the counter.

**The Progressive Disclosure Rule.** The default billing path — pick customer, add services,
take payment, print — is visible with nothing else competing for attention. Discounts, split
payments, package redemption, staff attribution and manual overrides are one deliberate step
away. Every option promoted to the default view costs the common path some of its speed.

## Elevation & Depth

**This system is flat.** There are no drop shadows, no floating cards, no glass, no backdrop
blur. Depth is carried by tonal step — Panel White sitting on Field Grey-White — and by
hairline rules.

This is a correctness decision and a performance one at once. The target hardware is a 4 GB
i3; shadow stacks and blur are measurable cost on exactly the machine that must feel
instant. And a flat field with hairline separation is easier to scan than a page of floating
rectangles, which is what a dense table screen actually needs.

### Named Rules

**The Flat Desk Rule.** Separation comes from a tonal step or a hairline, never from a
shadow. The only permitted elevation is a true overlay — a modal or a dropdown — which earns
a scrim rather than a shadow.

## Shapes

Restrained, near-square geometry. Corners are softened just enough to read as contemporary
software and never enough to read as playful. Radius is a single small value applied
consistently to buttons, inputs, panels and pills, with a slightly larger value reserved for
overlays.

Because `site_settings.theme` ships a `radius` token (`sm | md | lg`), tenant configuration
can shift the form language one step in either direction. The scale is bounded deliberately:
a tenant cannot produce fully-round pill chrome or hard industrial corners, so no
configuration can break the system's character.

Borders are hairline and single-weight. Buttons are solid fills, not outlines with
shadows — the combination of a visible border, a radius and a shadow on the same element is
a tell, not a style.

Exact radius values are `[to be resolved during implementation]`.

## Do's and Don'ts

### Do:

- **Do** use Signal Blue for settled and committed states and for the primary action, and
  Signal Yellow for anything waiting on a human — pending sync, low stock, unpaid bills,
  invoice blocks running low.
- **Do** put near-black Warm Ink on every yellow surface.
- **Do** set every money and quantity figure in tabular numerals, right-aligned.
- **Do** reserve permanent header space for the offline and pending-sync indicator so its
  appearance never reflows the screen.
- **Do** separate surfaces with a hairline or a tonal step.
- **Do** keep the tenant's colour on their public site and identity strip only.
- **Do** design at 1366×768 on a low-quality panel as the target, and verify contrast there
  rather than on a good display.
- **Do** give every screen one primary action in a predictable position, and fold rare
  options behind a deliberate step.
- **Do** vary the spacing scale so grouping is visible, with more room above a heading than
  below it.
- **Do** write labels in the words the front desk actually uses at the counter, not in
  product-team abstractions.
- **Do** run `npx impeccable detect` on changed UI files before considering a screen done.

### Don't:

- **Don't** put a spinner or a loading state on anything that only touches local storage.
  Local operations complete faster than a spinner can fade in; adding one teaches the front
  desk the app is slow when it isn't.
- **Don't** add a third signal colour, or colour a category, chart series or header for
  decoration. Colour is state here and nothing else.
- **Don't** put white text on Signal Yellow.
- **Don't** use drop shadows, floating cards, glass or backdrop blur.
- **Don't** combine a visible border, a corner radius and a shadow on the same element.
- **Don't** let a salon's brand colour reach a control, a status indicator or a table.
- **Don't** show connection state as a transient toast. It is a persistent condition and
  belongs in persistent chrome.
- **Don't** use pure black or pure white for text; the ink is warm near-black.
- **Don't** signal a state with colour alone — pair every colour with a label, icon or
  position, so the meaning survives a bad monitor and a colour-blind reader.
- **Don't** ship the machine-made tells: violet or indigo gradients, gradient text on
  headings, glowing accents, a coloured accent bar down the left edge of a card, cards nested
  inside cards, three-up grids of icon circles, or emoji used as interface icons.
- **Don't** use one repeated gap for every space on the page, or one type size and weight for
  every piece of text. Flat spacing and flat hierarchy are the two loudest signs that nobody
  made a decision.
- **Don't** centre everything. Text blocks, tables and forms align left; centring is for the
  rare thing that is genuinely alone on screen.
- **Don't** animate with bounce or elastic easing, and don't animate layout properties. Motion
  is functional and brief or it is absent.
- **Don't** put two competing primary buttons on one screen, or surface a rare option in the
  default path because it was easier than designing the disclosure.
