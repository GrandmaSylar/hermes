/**
 * Money is handled as decimal strings with exactly two fraction digits (GHS),
 * and summed in integer minor units (pesewas) so no floating point is involved.
 */

const AMOUNT_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

/** True when the text is a non-negative amount with at most two fraction digits. */
export function isAmountText(value: string): boolean {
  return AMOUNT_PATTERN.test(value.trim());
}

/** Converts "12.5" to 1250n. Throws on anything that is not a valid amount. */
export function toMinor(value: string): bigint {
  const text = value.trim();
  if (!AMOUNT_PATTERN.test(text)) throw new Error(`Invalid amount: "${value}"`);
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
}

/** Converts 1250n to "12.50". */
export function fromMinor(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

/** Normalises a valid amount to two fraction digits ("5" becomes "5.00"). */
export function normaliseAmount(value: string): string {
  return fromMinor(toMinor(value));
}

export function sumAmounts(values: string[]): string {
  return fromMinor(values.reduce((total, v) => total + toMinor(v), 0n));
}

/** Adds thousands separators for display only, e.g. "1250.00" to "1,250.00". */
export function formatAmount(value: string): string {
  const [whole, fraction] = normaliseAmount(value).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}
