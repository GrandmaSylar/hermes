import { kindForProduct, sumBalances } from '@/domain/deposit';
import type { MemberTypeOption } from '@/domain/registration';
import type { AccountOption, MemberAccounts, MobilizerLimits, Session } from '@/domain/types';
import {
  ApiError,
  type ApiCapabilities,
  type ApiClient,
  type DocumentResult,
  type DocumentUpload,
  type MemberConflict,
  type MemberLookup,
  type MemberPage,
  type OfficeDecision,
  type OfficeProfile,
  type PushItem,
  type PushRegistration,
  type PushResult,
  type RegistrationResult,
  type SavingsAccountPage,
  type ServerMember,
  type SignInResult,
} from './contract';

/**
 * HTTP client for the QSS field server (see /server). The server sits in front
 * of the core banking database: it signs bankers in with their PIN, lists their
 * branch's members with savings account ids, and stores each deposit as a
 * pending request that the office approves in the Approval Center.
 *
 * What the core cannot do yet is switched off in `capabilities`, so the app
 * never offers it. Nothing in this file posts to a ledger: a field deposit is
 * only ever sent as a request for the office to approve.
 */

export interface HttpApiOptions {
  /** For example https://field.example.com. No trailing path. */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Called with the renewed session tokens so the app can store them. */
  onTokens?: (tokens: { accessToken: string; refreshToken: string }) => void;
}

export const DEFAULT_LIMITS: MobilizerLimits = {
  maxUnsyncedItems: 200,
  maxUnsyncedAmount: '50000.00',
  maxSingleAmount: '5000.00',
};

const PAGE_SIZE = 200;
const V1 = '/v1';

/** A 4xx answer about one request (not the session): bad input, not found, conflict. */
export class HttpStatusError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpStatusError';
  }
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

type Json = Record<string, unknown>;

const asRecord = (value: unknown): Json => (value && typeof value === 'object' ? (value as Json) : {});
const asText = (value: unknown): string => (typeof value === 'string' ? value : value == null ? '' : String(value));

/**
 * A decimal string from the core as exactly two decimals, without going through
 * floating point. The core stores money to 2 places, so extra digits are zeros.
 */
export function twoDecimals(value: unknown): string | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(asText(value).trim());
  if (!m) return null;
  return `${m[1]}${m[2]}.${(m[3] ?? '').padEnd(2, '0').slice(0, 2)}`;
}

/** The server answers with `message` (an error) or `reason` (why a deposit was refused). */
export function messageFrom(body: unknown, fallback: string): string {
  const record = asRecord(body);
  const message = record.message;
  if (Array.isArray(message)) return message.map(asText).join(' ');
  if (typeof message === 'string' && message.trim()) return message;
  const reason = record.reason;
  return typeof reason === 'string' && reason.trim() ? reason : fallback;
}

/** The server already reduces the core's status codes to ACTIVE, PENDING or INACTIVE. */
export function mapMemberStatus(status: string): ServerMember['status'] {
  const s = status.trim().toUpperCase();
  if (s === 'ACTIVE') return 'ACTIVE';
  if (s === 'PENDING') return 'PENDING_APPROVAL';
  return 'INACTIVE';
}

/** One list of accounts from the server. Rows without a usable id are dropped. */
function mapAccountList(value: unknown, fallbackName: string): AccountOption[] {
  const accounts: AccountOption[] = [];
  for (const row of Array.isArray(value) ? value : []) {
    const r = asRecord(row);
    const id = Number(r.id);
    if (r.id == null || !Number.isInteger(id) || id <= 0) continue;
    accounts.push({
      id,
      number: asText(r.number).trim() || String(id),
      productCode: asText(r.productCode).trim(),
      productName: asText(r.productName).trim() || fallbackName,
      balance: twoDecimals(r.balance) ?? '0.00',
    });
  }
  return accounts;
}

/**
 * The member's accounts. An older server sends no `accounts` object; the one
 * savings account it does send is then offered, so the app still works.
 */
export function mapAccounts(r: Json, savingsAccountId: number | null): MemberAccounts {
  const raw = r.accounts;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const a = asRecord(raw);
    return { savings: mapAccountList(a.savings, 'Savings'), shares: mapAccountList(a.shares, 'Shares') };
  }
  if (savingsAccountId == null) return { savings: [], shares: [] };
  return {
    savings: [
      {
        id: savingsAccountId,
        number: String(savingsAccountId),
        productCode: '',
        productName: 'Savings',
        balance: twoDecimals(r.savingsBalance) ?? '0.00',
      },
    ],
    shares: [],
  };
}

export function mapMember(row: unknown, asOf: string, branchCode: string): ServerMember {
  const r = asRecord(row);
  const accountId = Number(r.savingsAccountId);
  const savingsAccountId = r.savingsAccountId != null && Number.isInteger(accountId) && accountId > 0 ? accountId : null;
  const accounts = mapAccounts(r, savingsAccountId);
  // The savings figure is the total over the member's savings accounts; with one account it is that balance.
  const savings =
    accounts.savings.length > 0 ? sumBalances(accounts.savings.map((a) => a.balance)) : (twoDecimals(r.savingsBalance) ?? '0.00');
  return {
    memberCode: asText(r.code),
    name: asText(r.fullName).trim(),
    phone: asText(r.phone),
    status: mapMemberStatus(asText(r.status)),
    branchCode,
    // Shares are the total over the member's share holdings. The loan is not available to the field channel.
    balances: { savings, shares: accounts.shares.length > 0 ? sumBalances(accounts.shares.map((a) => a.balance)) : null, loan: null },
    asOf,
    savingsAccountId,
    accounts,
  };
}

export class HttpApi implements ApiClient {
  office: OfficeProfile | null = null;
  readonly capabilities: ApiCapabilities = {
    otp: false,
    registration: false,
    documents: false,
    officeDecisions: true,
    // Hidden until the core can record Mobile Money as such: approval would post it as banker cash.
    mobileMoney: false,
    shareContribution: true,
    loanRepayment: false,
  };

  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly onTokens?: HttpApiOptions['onTokens'];
  private tokens: Tokens | null = null;
  private refreshing: Promise<Tokens> | null = null;

  constructor(options: HttpApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.onTokens = options.onTokens;
  }

  /** Forget the tokens held in memory, e.g. on sign-out. */
  reset(): void {
    this.tokens = null;
    this.refreshing = null;
  }

  // ---- sign-in --------------------------------------------------------

  /**
   * Staff ID and PIN. The server checks the PIN against the core system and
   * answers with the banker's details and limits, so there is no second step.
   */
  async login(staffId: string, pin: string, deviceId: string): Promise<SignInResult> {
    let body: Json;
    try {
      body = asRecord(await this.send(null, 'POST', `${V1}/auth/login`, { username: staffId.trim(), pin, deviceId }));
    } catch (error) {
      if (error instanceof HttpStatusError && (error.status === 400 || error.status === 401 || error.status === 403)) {
        throw new ApiError('AUTH', error.status === 400 ? 'Enter your staff ID and PIN.' : error.message);
      }
      if (error instanceof ApiError && error.kind === 'AUTH') {
        throw new ApiError('AUTH', 'Staff ID or PIN is incorrect.');
      }
      throw error;
    }
    const accessToken = asText(body.accessToken);
    const officer = asRecord(body.officer);
    if (!accessToken || !asText(officer.id)) throw new ApiError('SERVER', 'The server did not return a session.');
    const refreshToken = asText(body.refreshToken);
    this.tokens = { accessToken, refreshToken };

    const limits = asRecord(body.limits);
    const session: Session = {
      officerId: asText(officer.id),
      officerName: asText(officer.fullName) || staffId.trim(),
      branchCode: asText(officer.branchCode),
      deviceId,
      accessToken,
      refreshToken,
      limits: {
        maxUnsyncedItems: Number.isInteger(Number(limits.maxUnsyncedItems)) && Number(limits.maxUnsyncedItems) > 0 ? Number(limits.maxUnsyncedItems) : DEFAULT_LIMITS.maxUnsyncedItems,
        maxUnsyncedAmount: twoDecimals(limits.maxUnsyncedAmount) ?? DEFAULT_LIMITS.maxUnsyncedAmount,
        maxSingleAmount: twoDecimals(limits.maxSingleAmount) ?? DEFAULT_LIMITS.maxSingleAmount,
      },
    };
    return { kind: 'SIGNED_IN', session };
  }

  async verifyOtp(): Promise<Session> {
    throw new ApiError('SERVER', 'This server does not use SMS codes.');
  }

  async limits(session: Session): Promise<MobilizerLimits> {
    return session.limits;
  }

  // ---- reading data ---------------------------------------------------

  async pullMembers(session: Session, cursor: string | null): Promise<MemberPage> {
    const query = `limit=${PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const body = asRecord(await this.send(session, 'GET', `${V1}/members?${query}`));
    const asOf = new Date().toISOString();
    const items = (Array.isArray(body.items) ? body.items : []).map((row) => mapMember(row, asOf, session.branchCode));
    const next = asText(body.nextCursor);
    return { items, nextCursor: next || null };
  }

  /**
   * The server sends each member's savings account and balance with the member,
   * so there is nothing more to fetch. Kept so the sync engine's second stage
   * ends at once.
   */
  async pullSavingsAccounts(): Promise<SavingsAccountPage> {
    return { items: [], nextCursor: null };
  }

  // ---- sending data ---------------------------------------------------

  /**
   * One request per item, each with its own idempotency key
   * (device id + local id). If the connection or session fails part-way, the
   * answers so far are returned and the rest stay waiting on the phone.
   */
  async pushTransactions(session: Session, items: PushItem[]): Promise<PushResult[]> {
    const results: PushResult[] = [];
    for (const item of items) {
      try {
        results.push(await this.pushOne(session, item));
      } catch (error) {
        const interrupted = error instanceof ApiError && (error.kind === 'NETWORK' || error.kind === 'AUTH');
        if (interrupted && results.length > 0) return results;
        throw error;
      }
    }
    return results;
  }

  private async pushOne(session: Session, item: PushItem): Promise<PushResult> {
    const id = item.localTransactionId;
    // Savings and shares deposits only. A loan repayment is never sent.
    if (item.productType !== 'SAVINGS_DEPOSIT' && item.productType !== 'SHARE_CONTRIBUTION') {
      return { localTransactionId: id, status: 'REJECTED', reason: 'The core system does not accept this type of collection from the field yet.' };
    }
    if (kindForProduct(item.productType) !== item.kind) {
      return { localTransactionId: id, status: 'REJECTED', reason: 'This deposit does not match its account type.' };
    }
    // The core would post any approved deposit as banker cash, so Mobile Money is never sent.
    if (item.paymentMode !== 'CASH') {
      return { localTransactionId: id, status: 'REJECTED', reason: 'Only cash deposits can be sent to the office yet.' };
    }
    if (item.accountId == null) {
      const what = item.kind === 'SHARES' ? 'shares account' : 'savings account';
      return { localTransactionId: id, status: 'REJECTED', reason: `This deposit has no ${what} on file.` };
    }
    const body = {
      localTransactionId: id,
      kind: item.kind,
      memberCode: item.memberCode,
      accountId: item.accountId,
      amount: item.amount,
      collectedAt: item.collectedAt,
      paymentMode: item.paymentMode,
    };
    try {
      const saved = asRecord(await this.send(session, 'POST', `${V1}/deposits`, body));
      const status = asText(saved.status) === 'DUPLICATE' ? 'DUPLICATE' : 'ACCEPTED';
      return { localTransactionId: id, status, serverId: asText(saved.serverId) || undefined };
    } catch (error) {
      if (error instanceof HttpStatusError) {
        // 409: the same id came back with different details. 422: the office rules refused it.
        return { localTransactionId: id, status: error.status === 409 ? 'CONFLICT' : 'REJECTED', reason: error.message };
      }
      throw error;
    }
  }

  /**
   * What the office has done with this banker's collections. The server reports
   * the core system's own words; only the four the app knows are passed on.
   */
  async pullDecisions(session: Session, since: string | null): Promise<OfficeDecision[]> {
    const query = `limit=500${since ? `&since=${encodeURIComponent(since)}` : ''}`;
    const body = asRecord(await this.send(session, 'GET', `${V1}/deposits?${query}`));
    const decisions: OfficeDecision[] = [];
    for (const row of Array.isArray(body.items) ? body.items.map(asRecord) : []) {
      const status = asText(row.status).trim().toUpperCase();
      if (status !== 'PENDING' && status !== 'APPROVED' && status !== 'VERIFIED' && status !== 'REJECTED') continue;
      const id = asText(row.localTransactionId);
      if (!id) continue;
      decisions.push({
        localTransactionId: id,
        status,
        decidedAt: asText(row.decidedAt) || null,
        reason: status === 'REJECTED' ? asText(row.reason) || null : null,
      });
    }
    return decisions;
  }

  /** Registration is only offered once the server says it is switched on (its database must allow it). */
  async refreshCapabilities(session: Session): Promise<void> {
    const body = asRecord(await this.send(session, 'GET', `${V1}/me`));
    const capabilities = asRecord(body.capabilities);
    this.capabilities.registration = capabilities.registration === true;
    this.capabilities.documents = capabilities.documents === true;
    const branch = body.branch === null || body.branch === undefined ? null : asRecord(body.branch);
    this.office = branch
      ? { creditUnion: asText(branch.creditUnion), branchName: asText(branch.name), branchCode: asText(branch.code), city: asText(branch.city) }
      : null;
  }

  async fetchLogo(session: Session, have: string | null) {
    const query = have ? `?have=${encodeURIComponent(have)}` : '';
    const body = asRecord(await this.send(session, 'GET', `${V1}/credit-union/logo${query}`));
    const version = asText(body.version);
    if (!version) return null;
    if (body.unchanged === true) return 'UNCHANGED' as const;
    const dataUri = asText(body.dataUri);
    return dataUri ? { version, dataUri } : null;
  }

  async pushRegistrations(session: Session, items: PushRegistration[]): Promise<RegistrationResult[]> {
    const results: RegistrationResult[] = [];
    for (const item of items) results.push(await this.registerOne(session, item));
    return results;
  }

  private async registerOne(session: Session, item: PushRegistration): Promise<RegistrationResult> {
    const id = item.localRegistrationId;
    try {
      const saved = asRecord(await this.send(session, 'POST', `${V1}/registrations`, item));
      const status = asText(saved.status) === 'DUPLICATE' ? 'DUPLICATE' : 'ACCEPTED';
      return { localRegistrationId: id, status, serverId: asText(saved.serverId) || undefined };
    } catch (error) {
      if (error instanceof HttpStatusError) {
        // 409: the same id came back with different details. 400 and 422: the rules refused it.
        return { localRegistrationId: id, status: error.status === 409 ? 'CONFLICT' : 'REJECTED', reason: error.message };
      }
      throw error;
    }
  }

  async uploadDocument(session: Session, memberCode: string, upload: DocumentUpload): Promise<DocumentResult> {
    try {
      // A picture is a few hundred kilobytes: give a slow connection longer than a normal request.
      await this.send(session, 'POST', `${V1}/members/${encodeURIComponent(memberCode)}/documents`, upload, {}, false, this.timeoutMs * 3);
      return { status: 'SAVED' };
    } catch (error) {
      if (error instanceof HttpStatusError) return { status: error.status === 409 ? 'CONFLICT' : 'REJECTED', reason: error.message };
      throw error;
    }
  }

  async memberTypes(session: Session): Promise<MemberTypeOption[]> {
    const body = asRecord(await this.send(session, 'GET', `${V1}/member-types`));
    const types: MemberTypeOption[] = [];
    for (const row of Array.isArray(body.items) ? body.items.map(asRecord) : []) {
      const code = asText(row.code).trim();
      if (!code) continue;
      types.push({
        code,
        label: asText(row.label).trim() || code,
        sharesOptional: row.sharesOptional === true,
        guardianRequired: row.guardianRequired === true,
      });
    }
    return types;
  }

  async checkMember(session: Session, lookup: MemberLookup): Promise<MemberConflict[]> {
    const body = asRecord(await this.send(session, 'POST', `${V1}/members/check`, lookup));
    return (Array.isArray(body.conflicts) ? body.conflicts.map(asRecord) : []).map((c) => ({
      label: asText(c.label),
      value: asText(c.value),
      memberCode: asText(c.memberCode),
      memberName: asText(c.memberName),
    }));
  }

  // ---- plumbing -------------------------------------------------------

  /**
   * Sends one request. A rejected session is renewed once and the request
   * repeated. Network problems become NETWORK errors, session problems AUTH,
   * and server trouble SERVER, so the sync engine can react to each. Other 4xx
   * answers are about this request alone and come back as HttpStatusError.
   */
  private async send(session: Session | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}, renewed = false, timeoutMs = this.timeoutMs): Promise<unknown> {
    if (session && this.tokens === null) {
      this.tokens = { accessToken: session.accessToken, refreshToken: session.refreshToken };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(session && this.tokens ? { authorization: `Bearer ${this.tokens.accessToken}` } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError('NETWORK', 'No connection to the server.');
    } finally {
      clearTimeout(timer);
    }

    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    if (response.ok) return parsed;

    const message = messageFrom(parsed, `The server refused the request (${response.status}).`);
    if (response.status === 401) {
      if (session && !renewed) {
        await this.renew();
        return this.send(session, method, path, body, headers, true, timeoutMs);
      }
      throw new ApiError('AUTH', session ? 'Your session has ended. Sign in again.' : message);
    }
    if (response.status === 403) throw new ApiError('SERVER', message);
    if (response.status === 429) throw new ApiError('SERVER', messageFrom(parsed, 'Too many requests. Wait a minute and try again.'));
    if (response.status >= 500) throw new ApiError('SERVER', 'The server had a problem. Try again shortly.');
    throw new HttpStatusError(response.status, message);
  }

  /** Renews the tokens. Calls made together share one renewal so the refresh token is only used once. */
  private renew(): Promise<Tokens> {
    if (this.refreshing) return this.refreshing;
    const current = this.tokens;
    if (!current) throw new ApiError('AUTH', 'Your session has ended. Sign in again.');
    this.refreshing = (async () => {
      try {
        const body = asRecord(await this.send(null, 'POST', `${V1}/auth/refresh`, { refreshToken: current.refreshToken }));
        const next = { accessToken: asText(body.accessToken), refreshToken: asText(body.refreshToken) || current.refreshToken };
        if (!next.accessToken) throw new ApiError('AUTH', 'Your session has ended. Sign in again.');
        this.tokens = next;
        this.onTokens?.(next);
        return next;
      } catch (error) {
        if (error instanceof ApiError && error.kind === 'AUTH') {
          this.tokens = null;
          throw new ApiError('AUTH', 'Your session has ended. Sign in again.');
        }
        throw error;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }
}
