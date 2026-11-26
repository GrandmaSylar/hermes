/** The office system's palette (cua-core): its blue, green, red and orange, on iOS-style grey grounds. */
export const colors = {
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
};

/** The Ghana Co-operative Credit Unions Association logo's own colours: its navy, and the red of the Ghana map. */
export const brand = { navy: '#03305C', blue: '#2D5F87', red: '#EA3137' };

/** The navy gradient, for hero cards and the sign-in screen. */
export const brandGradient = (angle = 150) => `linear-gradient(${angle}deg, ${brand.navy}, ${brand.blue})`;
