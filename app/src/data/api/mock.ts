import { toMinor } from '@/domain/money';
import type { MobilizerLimits, Session } from '@/domain/types';
import {
  ApiError,
  type ApiClient,
  type ApiCapabilities,
  type MemberPage,
  type SavingsAccountPage,
  type SignInResult,
  type PushItem,
  type PushRegistration,
  type PushResult,
  type RegistrationResult,
  type ServerMember,
} from './contract';

/**
 * In-app stand-in for the core system's field API, used until the real
 * `/v1/field` endpoints exist. It behaves like the real service is specified
 * to: idempotent on (deviceId, localTransactionId), a conflict when the same
 * local id returns with different details, and business rejections.
 *
 * DEVELOPMENT ONLY. The credentials below are fake test values and must never
 * be reused anywhere real.
 */
export const MOCK_STAFF_ID = 'FO001';
export const MOCK_PASSWORD = 'Passw0rd!';
export const MOCK_OTP = '123456';

const FIRST = ['Kwame', 'Ama', 'Kofi', 'Akosua', 'Yaw', 'Abena', 'Kwesi', 'Efua', 'Kojo', 'Adwoa', 'Nana', 'Esi', 'Fiifi', 'Maame', 'Kobby', 'Araba'];
const LAST = ['Mensah', 'Owusu', 'Boateng', 'Asante', 'Appiah', 'Addo', 'Ofori', 'Agyeman', 'Darko', 'Quaye', 'Tetteh', 'Annan', 'Sarpong', 'Amoah', 'Bonsu', 'Nkrumah'];

const LIMITS: MobilizerLimits = {
  maxUnsyncedItems: 200,
  maxUnsyncedAmount: '50000.00',
  maxSingleAmount: '5000.00',
};

function money(minor: number): string {
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}

/** Deterministic members so test runs and screens are repeatable. */
export function buildMockMembers(count: number, asOf: string): ServerMember[] {
  const members: ServerMember[] = [];
  for (let i = 0; i < count; i++) {
    const seed = (i * 2654435761) >>> 0;
    const status = i % 53 === 0 ? 'INACTIVE' : i % 97 === 0 ? 'PENDING_APPROVAL' : 'ACTIVE';
    members.push({
      memberCode: String(100001 + i),
      name: `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`,
      phone: `024${String(1000000 + (seed % 9000000))}`,
      status,
      branchCode: '001',
      balances: {
        savings: money(seed % 500000),
        shares: money((seed >> 3) % 200000),
        loan: i % 3 === 0 ? money((seed >> 5) % 800000) : '0.00',
      },
      asOf,
      savingsAccountId: 500000 + i,
    });
  }
  return members;
}

export interface MockApiOptions {
  memberCount?: number;
  /** Return true to simulate a lost connection for this call. */
  failNetwork?: () => boolean;
  now?: () => Date;
}

export class MockApi implements ApiClient {
  /** The mock behaves like the full target API, so every feature can be developed and tested. */
  readonly capabilities: ApiCapabilities = { otp: true, registration: true, shareContribution: true, loanRepayment: true };

  private readonly members: ServerMember[];
  private readonly seen = new Map<string, { fingerprint: string; serverId: string }>();
  private nextServerId = 1;
  private readonly challenges = new Set<string>();
  private readonly failNetwork: () => boolean;

  constructor(options: MockApiOptions = {}) {
    const now = (options.now ?? (() => new Date()))();
    this.members = buildMockMembers(options.memberCount ?? 5000, now.toISOString());
    this.failNetwork = options.failNetwork ?? (() => false);
  }

  private guard() {
    if (this.failNetwork()) throw new ApiError('NETWORK', 'No connection to the server.');
  }

  async login(staffId: string, password: string, _deviceId: string): Promise<SignInResult> {
    this.guard();
    if (staffId.trim().toUpperCase() !== MOCK_STAFF_ID || password !== MOCK_PASSWORD) {
      throw new ApiError('AUTH', 'Staff ID or password is incorrect.');
    }
    const challengeId = `challenge-${this.challenges.size + 1}`;
    this.challenges.add(challengeId);
    return { kind: 'OTP_REQUIRED', challengeId };
  }

  async verifyOtp(challengeId: string, otp: string, deviceId: string): Promise<Session> {
    this.guard();
    if (!this.challenges.has(challengeId) || otp !== MOCK_OTP) {
      throw new ApiError('AUTH', 'The code is incorrect or has expired.');
    }
    this.challenges.delete(challengeId);
    return {
      officerId: '00000000-0000-4000-8000-000000000001',
      officerName: 'Field Officer One',
      branchCode: '001',
      deviceId,
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      limits: LIMITS,
    };
  }

  async limits(): Promise<MobilizerLimits> {
    this.guard();
    return LIMITS;
  }

  async pullMembers(_session: Session, cursor: string | null): Promise<MemberPage> {
    this.guard();
    const pageSize = 1000;
    const start = cursor ? Number(cursor) : 0;
    const items = this.members.slice(start, start + pageSize);
    const next = start + pageSize;
    return { items, nextCursor: next < this.members.length ? String(next) : null };
  }

  async pullSavingsAccounts(_session: Session, cursor: string | null): Promise<SavingsAccountPage> {
    this.guard();
    const pageSize = 1000;
    const start = cursor ? Number(cursor) : 0;
    const items = this.members.slice(start, start + pageSize).map((m) => ({
      memberCode: m.memberCode,
      accountId: m.savingsAccountId ?? 0,
      balance: m.balances.savings,
    }));
    const next = start + pageSize;
    return { items, nextCursor: next < this.members.length ? String(next) : null };
  }

  async pushTransactions(session: Session, items: PushItem[]): Promise<PushResult[]> {
    this.guard();
    return items.map((item) => this.accept(session, item));
  }

  private readonly registrationsSeen = new Map<string, { fingerprint: string; serverId: string }>();
  private readonly registeredIds = new Set<string>();
  private nextDraftId = 1;

  async pushRegistrations(session: Session, items: PushRegistration[]): Promise<RegistrationResult[]> {
    this.guard();
    return items.map((item) => this.acceptRegistration(session, item));
  }

  private acceptRegistration(session: Session, item: PushRegistration): RegistrationResult {
    const id = item.localRegistrationId;
    const key = `${session.deviceId}:${id}`;
    const fingerprint = [item.firstName, item.lastName, item.dateOfBirth, item.phone, item.idType, item.idNumber].join('|');
    const existing = this.registrationsSeen.get(key);
    if (existing) {
      return existing.fingerprint === fingerprint
        ? { localRegistrationId: id, status: 'DUPLICATE', serverId: existing.serverId }
        : { localRegistrationId: id, status: 'CONFLICT', reason: 'This registration was already received with different details.' };
    }
    // The core system refuses a second member with the same ID number.
    const idKey = `${item.idType}:${item.idNumber}`;
    if (this.registeredIds.has(idKey)) {
      return {
        localRegistrationId: id,
        status: 'REJECTED',
        reason: 'A member with this ID number is already registered or waiting for approval.',
      };
    }
    this.registeredIds.add(idKey);
    const serverId = `MD-${String(this.nextDraftId++).padStart(6, '0')}`;
    this.registrationsSeen.set(key, { fingerprint, serverId });
    return { localRegistrationId: id, status: 'ACCEPTED', serverId };
  }

  private accept(session: Session, item: PushItem): PushResult {
    const key = `${session.deviceId}:${item.localTransactionId}`;
    const fingerprint = [item.memberCode, item.productType, item.amount, item.collectedAt].join('|');
    const existing = this.seen.get(key);
    if (existing) {
      return existing.fingerprint === fingerprint
        ? { localTransactionId: item.localTransactionId, status: 'DUPLICATE', serverId: existing.serverId }
        : {
            localTransactionId: item.localTransactionId,
            status: 'CONFLICT',
            reason: 'This entry was already received with different details.',
          };
    }

    const member = this.members.find((m) => m.memberCode === item.memberCode);
    if (!member) {
      return { localTransactionId: item.localTransactionId, status: 'REJECTED', reason: 'Member not found.' };
    }
    if (member.status !== 'ACTIVE') {
      return { localTransactionId: item.localTransactionId, status: 'REJECTED', reason: 'Member is not active.' };
    }
    if (toMinor(item.amount) > toMinor(LIMITS.maxSingleAmount)) {
      return { localTransactionId: item.localTransactionId, status: 'REJECTED', reason: 'Amount exceeds the single-collection limit.' };
    }
    if (item.productType === 'LOAN_REPAYMENT' && toMinor(member.balances.loan ?? '0') === 0n) {
      return { localTransactionId: item.localTransactionId, status: 'REJECTED', reason: 'Member has no outstanding loan.' };
    }

    const serverId = `FT-${String(this.nextServerId++).padStart(6, '0')}`;
    this.seen.set(key, { fingerprint, serverId });
    return { localTransactionId: item.localTransactionId, status: 'ACCEPTED', serverId };
  }
}
