/** Money is handled as whole pesewas (BigInt) and shown as two-decimal text. Never floats. */

const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;

export function isAmountText(value: string): boolean {
  return AMOUNT.test(value);
}

/** "12.5" -> 1250n. Throws on anything that is not a plain positive-style amount. */
export function toMinor(value: string): bigint {
  if (!isAmountText(value)) throw new Error(`Not an amount: ${value}`);
  const [whole, frac = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
}

export function fromMinor(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const text = `${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

/** A database decimal (number or numeric string) as two-decimal text. */
export function decimalText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '0.00';
  const n = typeof value === 'number' ? value : Number(String(value));
  if (!Number.isFinite(n)) return '0.00';
  return fromMinor(BigInt(Math.round(n * 100)));
}
