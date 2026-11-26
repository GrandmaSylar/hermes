import type { RegistrationItem } from './registration';
import type { Member, OutboxItem } from './types';

/** The history screens: every deposit and registration, filtered by day and status, a page at a time. */

export type HistoryStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type StatusFilter = 'ALL' | HistoryStatus;

export const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

export const PAGE_SIZE = 20;

/** Approved once the office has posted it; rejected if the system or the office refused it; otherwise still pending. */
export function depositStatus(item: Pick<OutboxItem, 'status' | 'officeStatus'>): HistoryStatus {
  if (item.status === 'REJECTED' || item.status === 'CONFLICT' || item.officeStatus === 'REJECTED') return 'REJECTED';
  if (item.status === 'SYNCED' && (item.officeStatus === 'APPROVED' || item.officeStatus === 'VERIFIED')) return 'APPROVED';
  return 'PENDING';
}

/** A registration is approved once the office has made the new member active (seen after the next member refresh). */
export function registrationStatus(item: Pick<RegistrationItem, 'status'>, member: Pick<Member, 'status'> | null): HistoryStatus {
  if (item.status === 'REJECTED' || item.status === 'CONFLICT') return 'REJECTED';
  if (item.status === 'SYNCED' && member?.status === 'ACTIVE') return 'APPROVED';
  return 'PENDING';
}

export const STATUS_WORDS: Record<HistoryStatus, string> = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected' };

export interface Page<T> {
  rows: T[];
  /** 1-based, kept inside the available pages. */
  page: number;
  pages: number;
  total: number;
}

export function paginate<T>(all: T[], page: number, size = PAGE_SIZE): Page<T> {
  const pages = Math.max(1, Math.ceil(all.length / size));
  const at = Math.min(Math.max(1, page), pages);
  return { rows: all.slice((at - 1) * size, at * size), page: at, pages, total: all.length };
}

export interface DayRange {
  /** "YYYY-MM-DD", inclusive. */
  from: string;
  to: string;
}

export type RangePreset = 'today' | '7d' | '30d' | 'all';

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All time' },
];

const ALL_FROM = '0000-01-01';
const ALL_TO = '9999-12-31';
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function presetRange(preset: RangePreset, today: Date): DayRange {
  if (preset === 'all') return { from: ALL_FROM, to: ALL_TO };
  const back = preset === 'today' ? 0 : preset === '7d' ? 6 : 29;
  return { from: iso(new Date(today.getTime() - back * 86_400_000)), to: iso(today) };
}

/** Which preset a range is, so its chip can light up; null for a hand-picked range. */
export function presetOf(range: DayRange, today: Date): RangePreset | null {
  const match = RANGE_PRESETS.find((p) => {
    const r = presetRange(p.value, today);
    return r.from === range.from && r.to === range.to;
  });
  return match?.value ?? null;
}

/** "26 Nov 2026" from "2026-11-26". */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function rangeLabel(range: DayRange): string {
  if (range.from === ALL_FROM) return 'All time';
  return range.from === range.to ? dayLabel(range.from) : `${dayLabel(range.from)} to ${dayLabel(range.to)}`;
}

/** A hand-picked start or end that would leave the range backwards pulls the other end along. */
export function withFrom(range: DayRange, from: string): DayRange {
  return { from, to: range.to < from || range.to === ALL_TO ? from : range.to };
}

export function withTo(range: DayRange, to: string): DayRange {
  return { from: range.from > to || range.from === ALL_FROM ? to : range.from, to };
}
