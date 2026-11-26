import { formatAmount, fromMinor, toMinor } from './money';
import type { OutboxItem, OutboxStatus } from './types';

/** The figures on the home screen, worked out from what is on this phone. */

export interface CashFigures {
  /** Deposits recorded. */
  count: number;
  /** Cash recorded, GHS, two decimals. Items the office refused are left out. */
  amount: string;
}

export interface HomeFigures {
  today: CashFigures;
  allTime: CashFigures;
  /** Items still on the phone or waiting for the office. */
  waitingToSync: number;
  needAttention: number;
  /** Items the office has not yet approved or refused. */
  awaitingOffice: number;
}

const refused = (status: OutboxStatus) => status === 'REJECTED' || status === 'CONFLICT';

function add(figures: { count: number; minor: bigint }, item: OutboxItem) {
  // A deposit the system refused is not cash that stands.
  if (refused(item.status) || item.officeStatus === 'REJECTED') return;
  figures.count += 1;
  figures.minor += toMinor(item.amount);
}

const done = (f: { count: number; minor: bigint }): CashFigures => ({ count: f.count, amount: fromMinor(f.minor) });

/** `day` is a UTC "YYYY-MM-DD", the same day the rest of the app counts "today" in. */
export function computeHomeFigures(items: OutboxItem[], day: string): HomeFigures {
  const today = { count: 0, minor: 0n };
  const all = { count: 0, minor: 0n };
  let waitingToSync = 0;
  let needAttention = 0;
  let awaitingOffice = 0;
  for (const item of items) {
    add(all, item);
    if (item.collectedAt.slice(0, 10) === day) add(today, item);
    if (item.status === 'PENDING' || item.status === 'SENDING') waitingToSync += 1;
    else if (refused(item.status)) needAttention += 1;
    else if (item.status === 'SYNCED' && (item.officeStatus === null || item.officeStatus === 'PENDING')) awaitingOffice += 1;
  }
  return { today: done(today), allTime: done(all), waitingToSync, needAttention, awaitingOffice };
}

/** "GHS 1,250.00" for a full figure, "GHS 12.4k" style is avoided: money is always shown exactly. */
export const ghs = (amount: string) => `GHS ${formatAmount(amount)}`;

/** The first word of a full name, for a greeting. */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? '';
}

export function greeting(now: Date): string {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** "just now", "5 min ago", "2 h ago", or a date: how long ago the phone last heard from the server. */
export function ago(iso: string | null, now: Date): string {
  if (!iso) return 'Never synced';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Never synced';
  const minutes = Math.max(0, Math.round((now.getTime() - then) / 60000));
  if (minutes < 1) return 'Synced just now';
  if (minutes < 60) return `Synced ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Synced ${hours} h ago`;
  return `Synced ${Math.round(hours / 24)} d ago`;
}
