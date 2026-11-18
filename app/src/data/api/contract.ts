import type { MemberBalances, MobilizerLimits, ProductType, Session } from '@/domain/types';

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

export interface ApiClient {
  /** Step 1 of first sign-in on a device: password. Returns an OTP challenge. */
  login(staffId: string, password: string): Promise<{ challengeId: string }>;
  /** Step 2: the SMS OTP. Returns the field session. */
  verifyOtp(challengeId: string, otp: string, deviceId: string): Promise<Session>;
  pullMembers(session: Session, cursor: string | null): Promise<MemberPage>;
  pushTransactions(session: Session, items: PushItem[]): Promise<PushResult[]>;
  pushRegistrations(session: Session, items: PushRegistration[]): Promise<RegistrationResult[]>;
  limits(session: Session): Promise<MobilizerLimits>;
}
