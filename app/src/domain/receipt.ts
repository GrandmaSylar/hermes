import type { HistoryStatus } from './history';
import { formatAmount } from './money';
import { PAYMENT_LABELS, PRODUCT_LABELS, type OutboxItem } from './types';
import { fullName, type RegistrationItem } from './registration';

/**
 * Receipts for POS (thermal) printers. A receipt is first built as a plain description, then laid out as lines of
 * monospace text sized to the paper: 58 mm paper takes 32 characters across, 80 mm takes 48. The same lines are
 * shown on screen, printed, saved as a PDF, or sent to a printer app as text, so what is previewed is what prints.
 */

export type PaperWidth = 58 | 80;

export const PAPER_WIDTHS: { value: PaperWidth; label: string }[] = [
  { value: 58, label: '58 mm' },
  { value: 80, label: '80 mm' },
];

export const COLUMNS: Record<PaperWidth, number> = { 58: 32, 80: 48 };

export interface ReceiptRow {
  label: string;
  value: string;
}

export interface ReceiptDoc {
  /** Centred at the top: the credit union, then its branch. */
  header: string[];
  /** e.g. "DEPOSIT RECEIPT". */
  title: string;
  /** The big figure, if the receipt has one. */
  amount?: ReceiptRow;
  rows: ReceiptRow[];
  /** Where the item stands with the office. */
  status: { label: string; detail?: string | null };
  /** Centred at the bottom. */
  footer: string[];
  /** When it was captured. */
  at: Date;
  /** Short reference printed on the slip. */
  reference: string;
  /** True when printed again some time after: marked so a copy is never mistaken for the first. */
  copy?: boolean;
}

// ---- layout ----------------------------------------------------------------------------------------------------

/** Breaks text into lines no wider than `width`, at spaces where it can and mid-word only when it must. */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (w.length > width) {
        if (line) {
          out.push(line);
          line = '';
        }
        out.push(w.slice(0, width));
        w = w.slice(width);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= width) line += ` ${w}`;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

export const center = (text: string, width: number): string => {
  const t = text.length > width ? text.slice(0, width) : text;
  const left = Math.floor((width - t.length) / 2);
  return ' '.repeat(left) + t;
};

/** "Label ........ value" on one line when it fits, otherwise the label, then the value on its own right-aligned lines. */
export function keyValue(label: string, value: string, width: number): string[] {
  if (label.length + 1 + value.length <= width) return [label + ' '.repeat(width - label.length - value.length) + value];
  const lines = [label];
  for (const part of wrap(value, width - 2)) lines.push(part.padStart(width));
  return lines;
}

const rule = (width: number, ch = '-') => ch.repeat(width);

const two = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "26 Nov 2026 15:05" in the phone's own clock. */
export const stamp = (d: Date): string => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`;

/** The receipt as lines of monospace text, none wider than the paper. */
export function layoutReceipt(doc: ReceiptDoc, columns: number): string[] {
  const lines: string[] = [];
  const centred = (text: string) => wrap(text, columns).map((l) => center(l, columns));

  for (const h of doc.header.filter(Boolean)) lines.push(...centred(h));
  lines.push('');
  lines.push(rule(columns, '='));
  lines.push(...centred(doc.title));
  if (doc.copy) lines.push(...centred('*** COPY ***'));
  lines.push(rule(columns, '='));
  lines.push(...keyValue('Date', stamp(doc.at), columns));
  lines.push(...keyValue('Ref', doc.reference, columns));
  lines.push(rule(columns));
  for (const r of doc.rows) lines.push(...keyValue(r.label, r.value, columns));
  if (doc.amount) {
    lines.push(rule(columns));
    lines.push(...keyValue(doc.amount.label.toUpperCase(), doc.amount.value, columns));
  }
  lines.push(rule(columns));
  lines.push(...keyValue('Status', doc.status.label.toUpperCase(), columns));
  if (doc.status.detail) lines.push(...wrap(doc.status.detail, columns));
  lines.push(rule(columns, '='));
  for (const f of doc.footer.filter(Boolean)) lines.push(...centred(f));
  return lines;
}

// ---- what goes on a receipt ------------------------------------------------------------------------------------

export interface Letterhead {
  creditUnion: string;
  branch: string;
  officer: string;
}

const STATUS_WORDS: Record<HistoryStatus, string> = { PENDING: 'Pending approval', APPROVED: 'Approved', REJECTED: 'Rejected' };

/** The short reference printed on a slip: the first eight characters of the id, in capitals. */
export const shortRef = (id: string) => id.replace(/^server-/, '').slice(0, 8).toUpperCase();

export function depositReceipt(item: OutboxItem, status: HistoryStatus, head: Letterhead, copy: boolean): ReceiptDoc {
  const rows: ReceiptRow[] = [
    { label: 'Member', value: item.memberName },
    { label: 'No.', value: item.memberCode },
    { label: 'For', value: PRODUCT_LABELS[item.productType] },
  ];
  if (item.accountLabel) rows.push({ label: 'Account', value: item.accountLabel });
  rows.push({ label: 'Payment', value: PAYMENT_LABELS[item.paymentMode] });
  if (head.officer) rows.push({ label: 'Received by', value: head.officer });
  const detail =
    status === 'REJECTED'
      ? item.officeReason || item.lastError || 'The office did not accept this deposit.'
      : status === 'PENDING'
        ? 'Not yet in the member account. It posts when the office approves.'
        : null;
  return {
    header: [head.creditUnion, head.branch],
    title: 'DEPOSIT RECEIPT',
    amount: { label: 'Amount', value: `GHS ${formatAmount(item.amount)}` },
    rows,
    status: { label: STATUS_WORDS[status], detail },
    footer: ['Keep this receipt', 'Thank you'],
    at: new Date(item.collectedAt),
    reference: shortRef(item.localTransactionId),
    copy,
  };
}

export function registrationReceipt(reg: RegistrationItem, status: HistoryStatus, head: Letterhead, copy: boolean): ReceiptDoc {
  const rows: ReceiptRow[] = [{ label: 'Name', value: fullName(reg) }];
  if (reg.serverId) rows.push({ label: 'Member no.', value: reg.serverId });
  if (reg.phone) rows.push({ label: 'Phone', value: reg.phone });
  if (head.officer) rows.push({ label: 'Registered by', value: head.officer });
  const detail =
    status === 'REJECTED'
      ? reg.lastError || 'The office did not accept this registration.'
      : status === 'PENDING'
        ? 'The member can transact once the office approves.'
        : null;
  return {
    header: [head.creditUnion, head.branch],
    title: 'MEMBER REGISTRATION',
    rows,
    status: { label: STATUS_WORDS[status], detail },
    footer: ['Keep this slip', 'Thank you'],
    at: new Date(reg.capturedAt),
    reference: shortRef(reg.serverId ?? reg.localRegistrationId),
    copy,
  };
}

// ---- for a printer ---------------------------------------------------------------------------------------------

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Points per millimetre, as expo-print measures pages. */
const PT_PER_MM = 72 / 25.4;

export interface PrintPage {
  html: string;
  /** Page size in points, for the print and PDF calls. */
  width: number;
  height: number;
}

/**
 * The receipt as a page exactly as wide as the paper. The type is sized so the widest line just fits, and the
 * page is as tall as the receipt needs, so a thermal printer feeds out only what was printed.
 */
export function printPage(lines: string[], paper: PaperWidth, logoDataUri: string | null): PrintPage {
  const columns = COLUMNS[paper];
  const width = Math.round(paper * PT_PER_MM);
  // Monospace characters are about 0.6 of their height wide; leave a little margin so nothing is clipped.
  const font = Math.floor((width * 0.94 * 10) / (columns * 0.6)) / 10;
  const lineHeight = font * 1.28;
  const logoHeight = logoDataUri ? 52 : 0;
  const height = Math.ceil(lines.length * lineHeight + logoHeight + 28);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=${width}">
<style>
  @page { size: ${paper}mm ${Math.ceil((height / PT_PER_MM) * 10) / 10}mm; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { width: ${width}pt; padding: 6pt 0 8pt; color: #000; }
  .logo { display: block; margin: 0 auto 4pt; height: 44pt; filter: grayscale(1) contrast(1.6); }
  pre { margin: 0; padding: 0; font-family: "Courier New", Courier, monospace; font-size: ${font}pt; line-height: ${lineHeight}pt; white-space: pre; }
</style></head><body>${logoDataUri ? `<img class="logo" src="${logoDataUri}" />` : ''}<pre>${escapeHtml(lines.join('\n'))}</pre></body></html>`;
  return { html, width, height };
}

/** The receipt as text, for sharing to a printer app. */
export const receiptText = (lines: string[]): string => lines.map((l) => l.replace(/\s+$/, '')).join('\n');
