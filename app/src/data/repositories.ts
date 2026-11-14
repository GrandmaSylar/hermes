import type { ServerMember } from './api/contract';
import type { Member, OutboxItem, OutboxStatus } from '@/domain/types';
import type { UnsyncedTotals } from '@/domain/capture';

/**
 * Storage interfaces. The app uses the SQLite (SQLCipher) implementation; the
 * unit tests use an in-memory one, so the sync logic can be tested without a
 * phone.
 */

export interface MemberRepo {
  upsertMany(members: ServerMember[]): Promise<void>;
  search(query: string, limit: number): Promise<Member[]>;
  get(memberCode: string): Promise<Member | null>;
  count(): Promise<number>;
  setMyCustomer(memberCode: string, value: boolean): Promise<void>;
  bumpCollectCount(memberCode: string): Promise<void>;
  /** Members marked "my customers". */
  mine(limit: number): Promise<Member[]>;
  /** Members the mobilizer collects from most often. */
  frequent(limit: number): Promise<Member[]>;
}

export type NewOutboxItem = Omit<
  OutboxItem,
  'status' | 'attempts' | 'lastError' | 'serverId'
>;

export interface OutboxRepo {
  enqueue(item: NewOutboxItem): Promise<void>;
  list(limit: number): Promise<OutboxItem[]>;
  /** Items to push: PENDING, oldest first. */
  due(limit: number): Promise<OutboxItem[]>;
  /** Moves items back to PENDING if the app died while they were SENDING. */
  recoverInterrupted(): Promise<void>;
  markSending(localTransactionIds: string[]): Promise<void>;
  applyResult(
    localTransactionId: string,
    status: OutboxStatus,
    patch: { serverId?: string | null; lastError?: string | null },
  ): Promise<void>;
  /** Puts items back to PENDING after a failed attempt (network), counting the attempt. */
  release(localTransactionIds: string[]): Promise<void>;
  unsyncedTotals(): Promise<UnsyncedTotals>;
  /** Items collected within a UTC day, "YYYY-MM-DD". */
  forDay(day: string): Promise<OutboxItem[]>;
}

export interface KvRepo {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface Repos {
  members: MemberRepo;
  outbox: OutboxRepo;
  kv: KvRepo;
}
