/**
 * Per-tenant theming, kept trivial on purpose (spec §11) — it is not worth
 * significant engineering time, but two things are non-negotiable and live here:
 *
 *   1. Contrast is enforced. Text on the accent auto-flips to white or near-black
 *      so a salon owner cannot pick a pale yellow accent and get white text no
 *      one can read. This is a WCAG AA check, computed, not eyeballed.
 *   2. The scale is derived from ONE primary. The owner picks a single colour (a
 *      preset or a custom hex); the tints and shades are generated, never asked
 *      for. Nine shade pickers is how you get unreadable dashboards.
 *
 * These are pure functions so the POS (which inlines the theme into index.html
 * on boot to avoid a colour flash) and the public site share exact behaviour.
 */

export interface ThemeInput {
  /** Accent colour, `#rrggbb`. */
  primary: string;
  sidebar?: 'dark' | 'light';
  radius?: 'sm' | 'md' | 'lg';
}

export interface ResolvedTheme {
  primary: string;
  /** Readable text colour ON the primary — auto-flipped for contrast. */
  onPrimary: string;
  sidebar: 'dark' | 'light';
  radius: 'sm' | 'md' | 'lg';
  /** A derived 50→900 scale for surfaces and hovers. */
  scale: Record<number, string>;
}

/** 10 curated, accessible accent presets. One custom hex field is allowed too. */
export const THEME_PRESETS: readonly { name: string; hex: string }[] = [
  { name: 'Signal Blue', hex: '#0f5da8' },
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Emerald', hex: '#0f766e' },
  { name: 'Rose', hex: '#be123c' },
  { name: 'Amber', hex: '#b45309' },
  { name: 'Indigo', hex: '#4338ca' },
  { name: 'Plum', hex: '#86198f' },
  { name: 'Slate', hex: '#334155' },
  { name: 'Forest', hex: '#166534' },
  { name: 'Clay', hex: '#9a3412' },
];

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Not a 6-digit hex colour: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** WCAG relative luminance of an sRGB colour. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The readable text colour to place ON a background — white or near-black,
 * whichever clears WCAG AA (4.5:1). This is the auto-flip that stops an owner's
 * pale accent from getting unreadable white text.
 */
export function readableTextOn(background: string): string {
  // Pure black/white, not a near-black: for a mid-tone accent (luminance ~0.2)
  // a near-black only reaches ~4.3:1, just under AA, while pure black clears it.
  // The whole point of this function is that the guarantee actually holds.
  const dark = '#000000';
  const light = '#ffffff';
  return contrastRatio(background, dark) >= contrastRatio(background, light) ? dark : light;
}

/** Mix a colour toward white (amount>0) or black (amount<0), amount in 0..1. */
function mix(hex: string, toward: 'white' | 'black', amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const t = toward === 'white' ? 255 : 0;
  const f = (c: number) => c + (t - c) * amount;
  return rgbToHex({ r: f(r), g: f(g), b: f(b) });
}

/** A 50→900 scale derived from one primary by mixing toward white/black. */
export function deriveScale(primary: string): Record<number, string> {
  return {
    50: mix(primary, 'white', 0.9),
    100: mix(primary, 'white', 0.8),
    200: mix(primary, 'white', 0.6),
    300: mix(primary, 'white', 0.4),
    400: mix(primary, 'white', 0.2),
    500: primary,
    600: mix(primary, 'black', 0.15),
    700: mix(primary, 'black', 0.3),
    800: mix(primary, 'black', 0.45),
    900: mix(primary, 'black', 0.6),
  };
}

/** Normalise raw theme input into a fully resolved, contrast-safe theme. */
export function resolveTheme(input: ThemeInput): ResolvedTheme {
  const primary = rgbToHex(hexToRgb(input.primary)); // validates + normalises
  return {
    primary,
    onPrimary: readableTextOn(primary),
    sidebar: input.sidebar ?? 'dark',
    radius: input.radius ?? 'md',
    scale: deriveScale(primary),
  };
}
