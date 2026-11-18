import type { SavingsAccountInfo, ServerMember } from './api/contract';
import type { Member, OutboxItem, OutboxStatus } from '@/domain/types';
import type { UnsyncedTotals } from '@/domain/capture';
import type { RegistrationItem } from '@/domain/registration';

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
  /** Records each member's savings account id and balance. Members not on the phone are ignored. */
  applySavingsAccounts(accounts: SavingsAccountInfo[]): Promise<void>;
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

export type NewRegistration = Omit<RegistrationItem, 'status' | 'attempts' | 'lastError' | 'serverId'>;

/** Registrations follow the same outbox life cycle as collections. */
export interface RegistrationRepo {
  enqueue(item: NewRegistration): Promise<void>;
  list(limit: number): Promise<RegistrationItem[]>;
  due(limit: number): Promise<RegistrationItem[]>;
  recoverInterrupted(): Promise<void>;
  markSending(ids: string[]): Promise<void>;
  applyResult(
    id: string,
    status: OutboxStatus,
    patch: { serverId?: string | null; lastError?: string | null },
  ): Promise<void>;
  release(ids: string[]): Promise<void>;
  /** Registrations not yet delivered (PENDING or SENDING). */
  waitingCount(): Promise<number>;
  /** True if this ID number is already in a registration saved on this phone and not rejected. */
  hasIdNumber(idNumber: string): Promise<boolean>;
  /** Registrations captured within a UTC day, "YYYY-MM-DD". */
  forDay(day: string): Promise<RegistrationItem[]>;
}

export interface KvRepo {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface Repos {
  members: MemberRepo;
  outbox: OutboxRepo;
  registrations: RegistrationRepo;
  kv: KvRepo;
}
