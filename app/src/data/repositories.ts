import type { OfficeDecision, SavingsAccountInfo, ServerMember } from './api/contract';
import type { Member, OutboxItem, OutboxStatus, OfficeStatus, ProductType } from '@/domain/types';
import type { UnsyncedTotals } from '@/domain/capture';
import type { RegistrationItem, KycFile, KycKind, RegistrationFile } from '@/domain/registration';

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
  /** The highest member code on the phone, or null when there are no members. */
  maxCode(): Promise<string | null>;
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
  'status' | 'attempts' | 'lastError' | 'serverId' | 'officeStatus' | 'officeReason' | 'officeDecidedAt'
>;

/** A deposit that came from the server rather than from this phone: it is already delivered, so only its outcome is kept. */
export interface ImportedDeposit {
  localTransactionId: string;
  memberCode: string;
  memberName: string;
  productType: ProductType;
  amount: string;
  collectedAt: string;
  serverId: string;
  officeStatus: OfficeStatus;
  officeReason: string | null;
  officeDecidedAt: string | null;
}

/** A registration that came from the server: the member exists, so only who and when are kept. */
export interface ImportedRegistration {
  serverId: string;
  firstName: string;
  lastName: string;
  gender: 'F' | 'M';
  dateOfBirth: string;
  phone: string;
  capturedAt: string;
}

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
  /** Adds deposits the server has for this officer that this phone does not know (made on another phone, or before a reinstall). Returns how many were new. */
  importDeposits(items: ImportedDeposit[]): Promise<number>;
  /** Items collected from one UTC day to another, both included ("YYYY-MM-DD"), newest first. */
  inRange(fromDay: string, toDay: string): Promise<OutboxItem[]>;
  /** How many delivered items the office has not yet finished with (no decision, or still pending). */
  awaitingDecision(): Promise<number>;
  /**
   * Records the office's decisions on delivered items. Decisions for items not on
   * this phone, or not yet delivered, are ignored. Returns how many items changed.
   */
  applyOfficeDecisions(decisions: OfficeDecision[]): Promise<number>;
}

export type NewRegistration = Omit<RegistrationItem, 'status' | 'attempts' | 'lastError' | 'serverId' | 'files'> & {
  /** The KYC files already copied into the app's own storage. */
  files: KycFile[];
};

/** A KYC file waiting to be sent, with the new member's number it belongs to. */
export interface FileToSend extends RegistrationFile {
  localRegistrationId: string;
  memberCode: string;
}

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
  /** Adds members the server says this officer registered that this phone does not know. Returns how many were new. */
  importRegistrations(items: ImportedRegistration[]): Promise<number>;
  /** Registrations captured from one UTC day to another, both included, newest first. */
  inRange(fromDay: string, toDay: string): Promise<RegistrationItem[]>;
  /** Files not yet delivered, for registrations the core system has received (so the member's number is known). */
  filesToSend(limit: number): Promise<FileToSend[]>;
  /** Records what happened to one file. Delivered and refused files count as done. */
  applyFileResult(localRegistrationId: string, kind: KycKind, status: 'SENT' | 'REJECTED', lastError?: string | null): Promise<void>;
  /** A registration that will never be delivered: its files will not be sent either. Returns them so they can be deleted. */
  abandonFiles(localRegistrationId: string, reason: string): Promise<RegistrationFile[]>;
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
