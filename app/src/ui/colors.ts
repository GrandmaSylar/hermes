/**
 * The app's colours, in two palettes. `colors` is one shared object whose values are swapped by `applyScheme`
 * when the light or dark appearance changes, so every screen that reads `colors.x` while rendering follows it.
 *
 * Light is the office system's palette (cua-core): its blue, green, red and orange on iOS-style grey grounds.
 * Dark is a true-black (AMOLED) palette: pure black ground, near-black cards, no navy anywhere, and brighter
 * accents so they hold their contrast against black.
 */

export type Scheme = 'light' | 'dark';

export interface Palette {
  bg: string;
  card: string;
  text: string;
  muted: string;
  border: string;
  primary: string;
  primaryDeep: string;
  primarySoft: string;
  primaryText: string;
  danger: string;
  dangerBg: string;
  ok: string;
  okBg: string;
  warn: string;
  warnBg: string;
  /** Filled input boxes, search bars and picture wells. */
  fill: string;
  /** Empty progress tracks, loading placeholders and segmented-control backgrounds. */
  track: string;
  /** Sheet grabbers and the dashed tear line. */
  grabber: string;
  /** Chevrons and empty-state glyphs: quieter than muted text. */
  faint: string;
  /** A row being pressed. */
  pressed: string;
  /** The "my customer" star. */
  star: string;
  /** Behind dialogs. */
  scrim: string;
  /** Large branded surfaces (hero cards, sign-in). */
  heroFrom: string;
  heroTo: string;
}

export const lightPalette: Palette = {
  bg: '#F2F4F8',
  card: '#FFFFFF',
  text: '#111827',
  muted: '#6B7280',
  border: '#E5E7EB',
  primary: '#1976D2',
  primaryDeep: '#0D47A1',
  primarySoft: '#E3F0FC',
  primaryText: '#FFFFFF',
  danger: '#D32F2F',
  dangerBg: '#FDE7E7',
  ok: '#2E7D32',
  okBg: '#E4F3E5',
  warn: '#B45309',
  warnBg: '#FFF1DB',
  fill: '#EEF1F6',
  track: '#E3E7EE',
  grabber: '#D5D9E2',
  faint: '#C4C9D4',
  pressed: '#EEF2F6',
  star: '#F5A623',
  scrim: 'rgba(8, 20, 45, 0.72)',
  heroFrom: '#03305C',
  heroTo: '#2D5F87',
};

export const darkPalette: Palette = {
  bg: '#000000',
  card: '#131416',
  text: '#F2F4F7',
  muted: '#8E96A3',
  border: '#25272C',
  primary: '#3B97F0',
  primaryDeep: '#9CCBFF',
  primarySoft: '#0F2236',
  primaryText: '#FFFFFF',
  danger: '#FF6B6B',
  dangerBg: '#2B1515',
  ok: '#5ACB63',
  okBg: '#10261A',
  warn: '#F5A94A',
  warnBg: '#2B1D09',
  fill: '#1D1F23',
  track: '#26292D',
  grabber: '#3A3E44',
  faint: '#5B616B',
  pressed: '#17191C',
  star: '#F5A623',
  scrim: 'rgba(0, 0, 0, 0.78)',
  heroFrom: '#24272C',
  heroTo: '#0A0B0C',
};

/** The live palette. Starts light; `applyScheme` rewrites it in place. */
export const colors: Palette = { ...lightPalette };

let current: Scheme = 'light';

export function applyScheme(scheme: Scheme): void {
  if (scheme === current) return;
  current = scheme;
  Object.assign(colors, scheme === 'dark' ? darkPalette : lightPalette);
}

export const currentScheme = (): Scheme => current;

/**
 * Brand surfaces. In light: QSS Core Banking's navy and the Ghana-map red from the CUA logo. In dark there is
 * no navy: the hero cards are graphite fading to black, and `navy`/`blue` follow that.
 */
export const brand = {
  get navy() {
    return colors.heroFrom;
  },
  get blue() {
    return colors.heroTo;
  },
  red: '#EA3137',
};

/** The hero-card gradient for the current appearance. */
export const brandGradient = (angle = 150) => `linear-gradient(${angle}deg, ${colors.heroFrom}, ${colors.heroTo})`;
