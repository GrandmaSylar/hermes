import type { MobilizerLimits, Session } from '@/domain/types';
import {
  ApiError,
  type ApiCapabilities,
  type ApiClient,
  type MemberPage,
  type PushItem,
  type PushRegistration,
  type PushResult,
  type RegistrationResult,
  type SavingsAccountPage,
  type ServerMember,
  type SignInResult,
} from './contract';

/**
 * HTTP client for the core banking system, written against the API as it
 * exists today (cua-core-api: /auth, /customers, /savings, /mobile-banking).
 *
 * What the core cannot do yet is switched off in `capabilities`, so the app
 * never offers it. Each gap is listed in docs/core-api-dev-brief.md and turns
 * on here when the core ships it. Nothing in this file posts to a ledger: a
 * field deposit is only ever sent as a request for the office to approve.
 */

export interface HttpApiOptions {
  /** For example https://staging.example.com. No trailing path. */
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

const PAGE_SIZE = 100;

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

/** Nest sends `message` as text or as a list of validation problems. */
export function messageFrom(body: unknown, fallback: string): string {
  const message = asRecord(body).message;
  if (Array.isArray(message)) return message.map(asText).join(' ');
  return typeof message === 'string' && message.trim() ? message : fallback;
}

/** The core's member status codes: PND, ACT, INA, DOR, SUS, CLO (or the long names). */
export function mapMemberStatus(code: string): ServerMember['status'] {
  const c = code.trim().toUpperCase();
  if (c.startsWith('ACT')) return 'ACTIVE';
  if (c.startsWith('PEN') || c === 'PND') return 'PENDING_APPROVAL';
  return 'INACTIVE';
}

export function mapMember(row: unknown, asOf: string): ServerMember {
  const r = asRecord(row);
  return {
    memberCode: asText(r.code),
    name: asText(r.fullName).trim() || `${asText(r.firstName)} ${asText(r.lastName)}`.trim(),
    phone: asText(r.phone),
    status: mapMemberStatus(asText(r.status)),
    branchCode: asText(r.branchCode),
    // The member list carries no balances. Savings come from the savings accounts pull;
    // shares and loan are not available to the field channel yet.
    balances: { savings: '0.00', shares: null, loan: null },
    asOf,
  };
}

export class HttpApi implements ApiClient {
  readonly capabilities: ApiCapabilities = {
    otp: false,
    registration: false,
    shareContribution: false,
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

  async login(staffId: string, password: string, deviceId: string): Promise<SignInResult> {
    let tokens: Tokens;
    try {
      const body = asRecord(await this.send(null, 'POST', '/auth/login', { username: staffId.trim(), password }));
      tokens = { accessToken: asText(body.accessToken), refreshToken: asText(body.refreshToken) };
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'AUTH') {
        throw new ApiError('AUTH', 'Staff ID or password is incorrect.');
      }
      throw error;
    }
    if (!tokens.accessToken) throw new ApiError('SERVER', 'The server did not return a session.');
    this.tokens = tokens;

    try {
      return { kind: 'SIGNED_IN', session: await this.openSession(staffId, deviceId, tokens) };
    } catch (error) {
      this.reset();
      throw error;
    }
  }

  async verifyOtp(): Promise<Session> {
    throw new ApiError('SERVER', 'This server does not use SMS codes.');
  }

  /**
   * Finds the signed-in person's mobile banker record and checks this phone is
   * registered to them. The core registers phones, not the phone itself, so an
   * unregistered phone is told its id to give to a supervisor.
   */
  private async openSession(staffId: string, deviceId: string, tokens: Tokens): Promise<Session> {
    const provisional = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken } as Session;

    const found = asRecord(
      await this.send(provisional, 'GET', `/mobile-banking/bankers?search=${encodeURIComponent(staffId.trim())}&limit=100`),
    );
    const officers = Array.isArray(found.items) ? found.items.map(asRecord) : [];
    const officer = officers.find((o) => asText(o.staffId).toLowerCase() === staffId.trim().toLowerCase());
    if (!officer) {
      throw new ApiError('AUTH', 'Your account is not set up as a mobile banker. Ask your supervisor.');
    }
    if (asText(officer.status).toUpperCase() !== 'ACTIVE') {
      throw new ApiError('AUTH', 'Your mobile banker profile is not active. Ask your supervisor.');
    }
    const officerId = asText(officer.officerId);

    const devices = asRecord(
      await this.send(provisional, 'GET', `/mobile-banking/devices?officerId=${encodeURIComponent(officerId)}&limit=100`),
    );
    const device = (Array.isArray(devices.items) ? devices.items.map(asRecord) : []).find(
      (d) => asText(d.deviceId) === deviceId,
    );
    if (!device) {
      throw new ApiError('AUTH', `This phone is not registered for field work. Give this phone ID to your supervisor: ${deviceId}`);
    }
    if (asText(device.status).toUpperCase() !== 'ACTIVE' || device.trusted !== true) {
      throw new ApiError('AUTH', 'This phone is registered but not yet approved as trusted. Ask your supervisor.');
    }

    // The officer's cash limit bounds the cash held before it reaches the office.
    const cashLimit = twoDecimals(officer.cashLimit);
    const limits: MobilizerLimits = {
      ...DEFAULT_LIMITS,
      maxUnsyncedAmount: cashLimit !== null && /[1-9]/.test(cashLimit) && !cashLimit.startsWith('-') ? cashLimit : DEFAULT_LIMITS.maxUnsyncedAmount,
    };

    return {
      officerId,
      officerName: asText(officer.displayName) || staffId.trim(),
      branchCode: asText(officer.branchCode),
      deviceId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      limits,
    };
  }

  async limits(session: Session): Promise<MobilizerLimits> {
    return session.limits;
  }

  // ---- reading data ---------------------------------------------------

  async pullMembers(session: Session, cursor: string | null): Promise<MemberPage> {
    const query = `limit=${PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const body = asRecord(await this.send(session, 'GET', `/customers?${query}`));
    const asOf = new Date().toISOString();
    const items = (Array.isArray(body.items) ? body.items : []).map((row) => mapMember(row, asOf));
    const next = asText(body.nextCursor);
    return { items, nextCursor: next || null };
  }

  /**
   * Each member's savings account id (deposits need it) and balance. Where a
   * member has several accounts, the repository keeps the lowest id; which
   * account a field deposit should go to is an open question for the business.
   */
  async pullSavingsAccounts(session: Session, cursor: string | null): Promise<SavingsAccountPage> {
    const query = `limit=${PAGE_SIZE}&status=ACTIVE${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const body = asRecord(await this.send(session, 'GET', `/savings/accounts?${query}`));
    const items = (Array.isArray(body.items) ? body.items : [])
      .map(asRecord)
      .filter((a) => Number.isInteger(Number(a.id)) && asText(a.customerCode) !== '')
      .map((a) => ({
        memberCode: asText(a.customerCode),
        accountId: Number(a.id),
        balance: twoDecimals(a.currentBalance) ?? '0.00',
      }));
    const next = asText(body.nextCursor);
    return { items, nextCursor: next || null };
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
    if (item.productType !== 'SAVINGS_DEPOSIT') {
      return { localTransactionId: id, status: 'REJECTED', reason: 'The core system does not accept this type of collection from the field yet.' };
    }
    if (item.accountId == null) {
      return { localTransactionId: id, status: 'REJECTED', reason: 'This member has no savings account on file.' };
    }
    const body = {
      officerId: session.officerId,
      deviceId: session.deviceId,
      localTransactionId: id,
      memberCode: item.memberCode,
      accountId: item.accountId,
      transactionType: 'DEPOSIT',
      amount: item.amount,
      currency: 'GHS',
      reference: item.reference ?? undefined,
      collectedAt: item.collectedAt,
    };
    try {
      const saved = asRecord(
        await this.send(session, 'POST', '/mobile-banking/transactions', body, {
          'idempotency-key': `${session.deviceId}:${id}`.slice(0, 255),
        }),
      );
      return { localTransactionId: id, status: 'ACCEPTED', serverId: asText(saved.transactionId) || undefined };
    } catch (error) {
      if (error instanceof HttpStatusError) {
        // 409: the same id came back with different details, or the same key was reused.
        return { localTransactionId: id, status: error.status === 409 ? 'CONFLICT' : 'REJECTED', reason: error.message };
      }
      throw error;
    }
  }

  async pushRegistrations(_session: Session, _items: PushRegistration[]): Promise<RegistrationResult[]> {
    // Switched off in `capabilities`; the sync engine never calls this.
    throw new ApiError('SERVER', 'Registering members from the field is not available yet.');
  }

  // ---- plumbing -------------------------------------------------------

  /**
   * Sends one request. A rejected session is renewed once and the request
   * repeated. Network problems become NETWORK errors, session problems AUTH,
   * and server trouble SERVER, so the sync engine can react to each. Other 4xx
   * answers are about this request alone and come back as HttpStatusError.
   */
  private async send(session: Session | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}, renewed = false): Promise<unknown> {
    if (session && this.tokens === null) {
      this.tokens = { accessToken: session.accessToken, refreshToken: session.refreshToken };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
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
        return this.send(session, method, path, body, headers, true);
      }
      throw new ApiError('AUTH', session ? 'Your session has ended. Sign in again.' : message);
    }
    if (response.status === 403) throw new ApiError('SERVER', message);
    if (response.status === 429) throw new ApiError('SERVER', 'Too many requests. Wait a minute and try again.');
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
        const body = asRecord(await this.send(null, 'POST', '/auth/refresh', { refreshToken: current.refreshToken }));
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
