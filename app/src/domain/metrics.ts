import { fromMinor, toMinor } from './money';
import type { OutboxItem } from './types';

export interface DayMetrics {
  /** Items captured that day. */
  count: number;
  /** All money received (every captured item). */
  credits: string;
  /** Credits later rejected by the core system or the office. */
  debits: string;
  /** Credits minus debits: the money that actually stands. */
  net: string;
  pending: number;
  synced: number;
  rejected: number;
}

/**
 * Provisional daily figures, computed on the device from its own items.
 * The server's figures replace these once synced (spec FR-9).
 */
export function computeDayMetrics(items: OutboxItem[]): DayMetrics {
  let credits = 0n;
  let debits = 0n;
  let pending = 0;
  let synced = 0;
  let rejected = 0;
  for (const item of items) {
    const amount = toMinor(item.amount);
    credits += amount;
    if (item.status === 'REJECTED' || item.status === 'CONFLICT') {
      debits += amount;
      rejected += 1;
    } else if (item.status === 'SYNCED') {
      synced += 1;
    } else {
      pending += 1;
    }
  }
  return {
    count: items.length,
    credits: fromMinor(credits),
    debits: fromMinor(debits),
    net: fromMinor(credits - debits),
    pending,
    synced,
    rejected,
  };
}
