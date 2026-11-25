/**
 * Member search rules, shared by the phone database and the in-memory test stand-in so both
 * behave the same.
 *
 * - The query is split into words and every word must match somewhere (so "mensah kofi" finds
 *   "Kofi Adu Mensah").
 * - A phone number matches however it is typed: "024 412 3456", "0244123456" or "+233244123456".
 * - An account number also finds its member.
 */

/** Strip the country prefix and formatting from something that looks like a phone number. */
function normalizeWord(word: string): string {
  const compact = word.replace(/[\s\-().]/g, '');
  const digits = compact.replace(/^\+/, '');
  if (/^\d+$/.test(digits) && digits.length >= 6) {
    // +233 24 412 3456 -> 244123456 (the part every format has in common).
    if (digits.startsWith('233')) return digits.slice(3);
    if (digits.startsWith('0')) return digits.slice(1);
    return digits;
  }
  return word;
}

/**
 * Words of the query, lower-cased. Runs of digits split by spaces or dashes (a phone number typed
 * in groups) are joined back into one word first.
 */
export function queryWords(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  // "024 412 3456" and "+233 24-412-3456" are one number, not three words.
  const grouped = q.replace(/(\+?\d[\d\s\-().]*\d)/g, (m) => (m.replace(/\D/g, '').length >= 6 ? m.replace(/[\s\-().]/g, '') : m));
  return grouped
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeWord);
}

/** The text a member is searched in: code, name and phone with formatting removed. */
export function memberHaystack(m: { memberCode: string; name: string; phone: string }): string {
  return `${m.memberCode} ${m.name} ${m.phone.replace(/[\s\-().+]/g, '')}`.toLowerCase();
}

/** True when every word of the query is found in the member's text or one of their account numbers. */
export function memberMatches(
  words: string[],
  m: { memberCode: string; name: string; phone: string },
  accountNumbers: string[],
): boolean {
  if (words.length === 0) return true;
  const hay = memberHaystack(m);
  const numbers = accountNumbers.map((n) => n.toLowerCase());
  return words.every((w) => hay.includes(w) || numbers.some((n) => n.includes(w)));
}

/** Lower is better: exact code, code prefix, name starts with, a name word starts with, anything else. */
export function memberRank(words: string[], m: { memberCode: string; name: string }): number {
  const first = words[0] ?? '';
  const code = m.memberCode.toLowerCase();
  const name = m.name.toLowerCase();
  if (first === '') return 4;
  if (code === first) return 0;
  if (code.startsWith(first)) return 1;
  if (name.startsWith(first)) return 2;
  if (name.split(/\s+/).some((part) => part.startsWith(first))) return 3;
  return 4;
}
