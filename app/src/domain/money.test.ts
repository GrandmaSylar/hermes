import { formatAmount, fromMinor, isAmountText, normaliseAmount, sumAmounts, toMinor } from './money';

describe('money', () => {
  test('parses amounts to minor units without floating point error', () => {
    expect(toMinor('0.1') + toMinor('0.2')).toBe(30n);
    expect(toMinor('12')).toBe(1200n);
    expect(toMinor('12.5')).toBe(1250n);
    expect(toMinor('999999999999.99')).toBe(99999999999999n);
  });

  test('rejects invalid amounts', () => {
    for (const bad of ['', 'abc', '-5', '1.234', '1,000', '1e3', '.5', '5.', '1 000']) {
      expect(isAmountText(bad)).toBe(false);
      expect(() => toMinor(bad)).toThrow();
    }
  });

  test('formats to two decimals', () => {
    expect(fromMinor(1250n)).toBe('12.50');
    expect(fromMinor(5n)).toBe('0.05');
    expect(fromMinor(-1250n)).toBe('-12.50');
    expect(normaliseAmount('5')).toBe('5.00');
    expect(normaliseAmount('5.1')).toBe('5.10');
  });

  test('sums exactly', () => {
    expect(sumAmounts(['0.10', '0.20', '0.30'])).toBe('0.60');
    expect(sumAmounts([])).toBe('0.00');
  });

  test('adds thousands separators for display only', () => {
    expect(formatAmount('1234567.5')).toBe('1,234,567.50');
    expect(formatAmount('12.00')).toBe('12.00');
  });
});
