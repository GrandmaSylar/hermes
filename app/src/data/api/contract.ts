import type { MemberBalances, MobilizerLimits, OfficeStatus, ProductType, Session } from '@/domain/types';

/**
 * The contract the app expects from the core banking system's field API.
 * It mirrors the `/v1/field` surface requested in docs/core-api-dev-brief.md,
 * and is implemented today by MockApi. A real HTTP client will implement the
 * same interface once the core team publishes the OpenAPI spec.
 */

export type ApiErrorKind = 'NETWORK' | 'AUTH' | 'SERVER';

export class ApiError extends Error {
  constructor(
    public readonly kind: ApiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ServerMember {
  memberCode: string;
  name: string;
  phone: string;
  status: 'ACTIVE' | 'PENDING_APPROVAL' | 'INACTIVE';
  branchCode: string;
  balances: MemberBalances;
  asOf: string;
  /** Present when the API can supply it with the member. */
  savingsAccountId?: number | null;
}

export interface MemberPage {
  items: ServerMember[];
  /** Null when there are no more pages. */
  nextCursor: string | null;
}

export interface PushItem {
  /** Unique per device. Together with the device id this is the idempotency key. */
  localTransactionId: string;
  memberCode: string;
  productType: ProductType;
  amount: string;
  reference: string | null;
  collectedAt: string;
  /** The member's savings account at the core. Required for a savings deposit. */
  accountId: number | null;
}

export type PushResultStatus = 'ACCEPTED' | 'DUPLICATE' | 'REJECTED' | 'CONFLICT';

export interface PushResult {
  localTransactionId: string;
  status: PushResultStatus;
  /** Present for ACCEPTED and DUPLICATE. */
  serverId?: string;
  /** Present for REJECTED and CONFLICT. */
  reason?: string;
}

/** A member registration waiting for office approval. Same idempotency rules as PushItem. */
export interface PushRegistration {
  localRegistrationId: string;
  firstName: string;
  lastName: string;
  gender: 'F' | 'M';
  dateOfBirth: string;
  phone: string;
  idType: string;
  idNumber: string;
  address: string;
  capturedAt: string;
}

export interface RegistrationResult {
  localRegistrationId: string;
  status: PushResultStatus;
  /** The office's draft reference. Present for ACCEPTED and DUPLICATE. */
  serverId?: string;
  /** Present for REJECTED and CONFLICT. */
  reason?: string;
}

/** A member's savings account at the core system, with its balance. */
export interface SavingsAccountInfo {
  memberCode: string;
  accountId: number;
  balance: string;
}

export interface SavingsAccountPage {
  items: SavingsAccountInfo[];
  nextCursor: string | null;
}

/**
 * What the core system can do for the field channel today. The app hides what
 * is off, so it never offers an action the core would refuse. Flags turn on as
 * the core ships support (see docs/core-api-dev-brief.md).
 */
/** What the office has decided about one collection the banker sent. */
export interface OfficeDecision {
  localTransactionId: string;
  status: OfficeStatus;
  decidedAt: string | null;
  /** Present when the office refused it. */
  reason: string | null;
}

export interface ApiCapabilities {
  /** The server can say what the office decided about each collection. */
  officeDecisions: boolean;
  /** Sign-in has a second step: an SMS code. */
  otp: boolean;
  /** New members can be registered from the field. */
  registration: boolean;
  shareContribution: boolean;
  loanRepayment: boolean;
}

export type SignInResult =
  | { kind: 'OTP_REQUIRED'; challengeId: string }
  | { kind: 'SIGNED_IN'; session: Session };

export interface ApiClient {
  readonly capabilities: ApiCapabilities;
  /** Forgets anything held in memory for the signed-in user. Called on sign-out. */
  reset?(): void;
  /**
   * Step 1 of first sign-in on a device: password. Either signs in, or asks
   * for an SMS code. The device id is sent so the core can check the phone is
   * registered.
   */
  login(staffId: string, password: string, deviceId: string): Promise<SignInResult>;
  /** Step 2 when the API asks for it: the SMS OTP. Returns the field session. */
  verifyOtp(challengeId: string, otp: string, deviceId: string): Promise<Session>;
  pullMembers(session: Session, cursor: string | null): Promise<MemberPage>;
  pullSavingsAccounts(session: Session, cursor: string | null): Promise<SavingsAccountPage>;
  pushTransactions(session: Session, items: PushItem[]): Promise<PushResult[]>;
  pushRegistrations(session: Session, items: PushRegistration[]): Promise<RegistrationResult[]>;
  /** The office's decisions on collections changed since the given time (or the latest ones if null). */
  pullDecisions(session: Session, since: string | null): Promise<OfficeDecision[]>;
  limits(session: Session): Promise<MobilizerLimits>;
}
