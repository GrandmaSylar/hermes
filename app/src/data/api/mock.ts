import { DEFAULT_MEMBER_TYPES, type MemberTypeOption } from '@/domain/registration';
import { kindForProduct, sumBalances } from '@/domain/deposit';
import { toMinor } from '@/domain/money';
import type { AccountOption, MobilizerLimits, Session } from '@/domain/types';
import { ApiError, type ApiClient, type DocumentResult, type DocumentUpload, type ApiCapabilities, type MemberPage, type OfficeDecision, type SavingsAccountPage, type SignInResult, type PushItem, type MemberConflict, type MemberLookup, type PushRegistration, type PushResult, type RegistrationResult, type ServerMember, type ServerDeposit, type ServerRegistration } from './contract';

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
    const n = i + 1;
    // Demo spread: every member has one savings account, every fourth a second one;
    // two members in three have a shares holding, every seventh a second one.
    const savings: AccountOption[] = [
      { id: 500000 + i, number: `${n}-KS`, productCode: 'KS', productName: 'Ordinary Savings', balance: money(seed % 500000) },
    ];
    if (i % 4 === 1) {
      savings.push({ id: 700000 + i, number: `${n}-SU`, productCode: 'SU', productName: 'Susu Savings', balance: money((seed >> 4) % 90000) });
    }
    const shares: AccountOption[] = [];
    if (i % 3 !== 2) {
      shares.push({ id: 800000 + i, number: `${n}-SH`, productCode: 'SH', productName: 'Ordinary Shares', balance: money((seed >> 3) % 200000) });
      if (i % 7 === 0) {
        shares.push({ id: 900000 + i, number: `${n}-PS`, productCode: 'PS', productName: 'Preference Shares', balance: money((seed >> 6) % 50000) });
      }
    }
    members.push({
      memberCode: String(100001 + i),
      name: `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`,
      phone: `024${String(1000000 + (seed % 9000000))}`,
      status,
      branchCode: '001',
      balances: {
        savings: sumBalances(savings.map((a) => a.balance)),
        shares: sumBalances(shares.map((a) => a.balance)),
        loan: i % 3 === 0 ? money((seed >> 5) % 800000) : '0.00',
      },
      asOf,
      savingsAccountId: 500000 + i,
      accounts: { savings, shares },
    });
  }
  return members;
}

export interface MockApiOptions {
  memberCount?: number;
  /** Return true to simulate a lost connection for this call. */
  failNetwork?: () => boolean;
  /** Demo toggle: offer Mobile Money as a payment mode. Off by default, like the real server. */
  mobileMoney?: boolean;
  now?: () => Date;
}

export class MockApi implements ApiClient {
  /** The mock behaves like the full target API, so every feature can be developed and tested. */
  readonly capabilities: ApiCapabilities;

  private readonly members: ServerMember[];
  private readonly seen = new Map<string, { fingerprint: string; serverId: string }>();
  private nextServerId = 1;
  private readonly challenges = new Set<string>();
  private readonly failNetwork: () => boolean;

  constructor(options: MockApiOptions = {}) {
    const now = (options.now ?? (() => new Date()))();
    this.members = buildMockMembers(options.memberCount ?? 5000, now.toISOString());
    this.failNetwork = options.failNetwork ?? (() => false);
    this.capabilities = {
      otp: true,
      registration: true,
      documents: true,
      favorites: true,
      officeDecisions: true,
      mobileMoney: options.mobileMoney ?? false,
      shareContribution: true,
      loanRepayment: true,
    };
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

  /** Demo: the office approves everything it has received, the next time the app asks. */
  async pullDecisions(session: Session, _since: string | null = null): Promise<OfficeDecision[]> {
    this.guard();
    const prefix = `${session.deviceId}:`;
    return [...this.seen.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => ({
        localTransactionId: key.slice(prefix.length),
        status: 'APPROVED' as const,
        decidedAt: new Date().toISOString(),
        reason: null,
      }));
  }

  private readonly registrationsSeen = new Map<string, { fingerprint: string; serverId: string }>();
  private readonly registeredIds = new Set<string>();
  private nextDraftId = 1;

  async memberTypes(_session: Session): Promise<MemberTypeOption[]> {
    this.guard();
    return DEFAULT_MEMBER_TYPES;
  }

  /** Who holds these IDs or this phone: members registered through this mock, by ID number. */
  async checkMember(_session: Session, lookup: MemberLookup): Promise<MemberConflict[]> {
    this.guard();
    const out: MemberConflict[] = [];
    const ids: [string, string | undefined][] = [
      ['Ghana Card', lookup.nationalId],
      ['Voter ID', lookup.voterIdNo],
      ['NHIS card', lookup.nhisNo],
      ['Passport', lookup.passportNo],
    ];
    for (const [label, value] of ids) {
      if (value && this.registeredIds.has(value)) out.push({ label, value, memberCode: 'MOCK', memberName: 'Another member' });
    }
    return out;
  }

  /** KYC files received, as "memberCode:kind" -> size in bytes. */
  readonly documents = new Map<string, number>();

  /** What the "server" remembers for the signed-in officer: favourites, and deposits and members from before this phone. */
  readonly favoriteCodes = new Set<string>();
  readonly priorDeposits: ServerDeposit[] = [];
  readonly priorRegistrations: ServerRegistration[] = [];

  async pullFavorites(_session: Session): Promise<string[]> {
    this.guard();
    return [...this.favoriteCodes].sort();
  }

  async setFavorite(_session: Session, memberCode: string, on: boolean): Promise<void> {
    this.guard();
    if (on) this.favoriteCodes.add(memberCode);
    else this.favoriteCodes.delete(memberCode);
  }

  async pullDeposits(_session: Session, _since: string | null): Promise<ServerDeposit[]> {
    this.guard();
    return [...this.priorDeposits];
  }

  async pullRegisteredMembers(_session: Session, _since: string | null): Promise<ServerRegistration[]> {
    this.guard();
    return [...this.priorRegistrations];
  }

  async uploadDocument(_session: Session, memberCode: string, upload: DocumentUpload): Promise<DocumentResult> {
    this.guard();
    if (!/^MD-\d+$/.test(memberCode)) return { status: 'REJECTED', reason: 'That member was not found.' };
    this.documents.set(`${memberCode}:${upload.kind}`, upload.dataBase64.length);
    return { status: 'SAVED' };
  }

  async pushRegistrations(session: Session, items: PushRegistration[]): Promise<RegistrationResult[]> {
    this.guard();
    return items.map((item) => this.acceptRegistration(session, item));
  }

  private acceptRegistration(session: Session, item: PushRegistration): RegistrationResult {
    const id = item.localRegistrationId;
    const key = `${session.deviceId}:${id}`;
    const fingerprint = [item.firstName, item.lastName, item.birthDate, item.phone, item.nationalId, item.voterIdNo, item.nhisNo, item.passportNo].join('|');
    const existing = this.registrationsSeen.get(key);
    if (existing) {
      return existing.fingerprint === fingerprint
        ? { localRegistrationId: id, status: 'DUPLICATE', serverId: existing.serverId }
        : { localRegistrationId: id, status: 'CONFLICT', reason: 'This registration was already received with different details.' };
    }
    // The core system refuses a second member with the same ID number.
    const idKeys = [item.nationalId, item.voterIdNo, item.nhisNo, item.passportNo].filter(Boolean);
    if (idKeys.some((k) => this.registeredIds.has(k))) {
      return {
        localRegistrationId: id,
        status: 'REJECTED',
        reason: 'A member with this ID number is already registered or waiting for approval.',
      };
    }
    idKeys.forEach((k) => this.registeredIds.add(k));
    const serverId = `MD-${String(this.nextDraftId++).padStart(6, '0')}`;
    this.registrationsSeen.set(key, { fingerprint, serverId });
    return { localRegistrationId: id, status: 'ACCEPTED', serverId };
  }

  private accept(session: Session, item: PushItem): PushResult {
    const key = `${session.deviceId}:${item.localTransactionId}`;
    const fingerprint = [item.memberCode, item.productType, item.kind, item.accountId, item.amount, item.collectedAt, item.paymentMode].join('|');
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
    if (item.paymentMode !== 'CASH') {
      return { localTransactionId: item.localTransactionId, status: 'REJECTED', reason: 'Only cash deposits are accepted.' };
    }
    const kind = kindForProduct(item.productType);
    if (kind) {
      const accounts = kind === 'SAVINGS' ? member.accounts.savings : member.accounts.shares;
      if (kind !== item.kind || !accounts.some((a) => a.id === item.accountId)) {
        return { localTransactionId: item.localTransactionId, status: 'REJECTED', reason: 'That account does not belong to this member.' };
      }
    }
    if (item.productType === 'LOAN_REPAYMENT' && toMinor(member.balances.loan ?? '0') === 0n) {
      return { localTransactionId: item.localTransactionId, status: 'REJECTED', reason: 'Member has no outstanding loan.' };
    }

    const serverId = `FT-${String(this.nextServerId++).padStart(6, '0')}`;
    this.seen.set(key, { fingerprint, serverId });
    return { localTransactionId: item.localTransactionId, status: 'ACCEPTED', serverId };
  }
}
