import { applyPreference, parsePreference } from './appearance';
import { applyScheme, brand, brandGradient, colors, currentScheme, darkPalette, lightPalette } from './colors';

describe('colour palettes', () => {
  afterEach(() => applyScheme('light'));

  test('light is the office palette and is the starting look', () => {
    expect(currentScheme()).toBe('light');
    expect(colors.bg).toBe(lightPalette.bg);
    expect(colors.primary).toBe('#1976D2');
  });

  test('dark is true AMOLED black, and its surfaces are neutral greys, not navy', () => {
    applyScheme('dark');
    expect(colors.bg).toBe('#000000');
    const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (const name of ['bg', 'card', 'fill', 'track', 'grabber', 'pressed', 'border', 'heroFrom', 'heroTo'] as const) {
      const [r, , b] = channels(darkPalette[name]);
      // A navy ground has much more blue than red (40 or more); these greys have a faint cool tint at most.
      expect(b - r).toBeLessThanOrEqual(12);
    }
    expect(darkPalette.heroFrom).not.toBe(lightPalette.heroFrom);
  });

  test('the shared colours object follows the scheme and back', () => {
    applyScheme('dark');
    expect(colors.card).toBe(darkPalette.card);
    expect(colors.text).toBe(darkPalette.text);
    applyScheme('light');
    expect(colors.card).toBe('#FFFFFF');
  });

  test('hero cards and the brand follow the scheme: navy in light, graphite in dark', () => {
    expect(brandGradient(150)).toBe('linear-gradient(150deg, #03305C, #2D5F87)');
    expect(brand.navy).toBe('#03305C');
    applyScheme('dark');
    expect(brandGradient(150)).toBe(`linear-gradient(150deg, ${darkPalette.heroFrom}, ${darkPalette.heroTo})`);
    expect(brand.navy).toBe(darkPalette.heroFrom);
    expect(brand.red).toBe('#EA3137');
  });

  test('every palette has every colour, so no screen can read an undefined one', () => {
    expect(Object.keys(darkPalette).sort()).toEqual(Object.keys(lightPalette).sort());
  });
});

describe('appearance choice', () => {
  test('anything unknown means follow the phone', () => {
    expect(parsePreference('dark')).toBe('dark');
    expect(parsePreference('light')).toBe('light');
    expect(parsePreference('system')).toBe('system');
    expect(parsePreference('purple')).toBe('system');
    expect(parsePreference(null)).toBe('system');
  });

  test('applying a choice never throws', () => {
    expect(() => applyPreference('dark')).not.toThrow();
    expect(() => applyPreference('system')).not.toThrow();
  });
});
