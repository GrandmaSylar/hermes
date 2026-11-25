import type { IdValues, RegistrationBody } from './registration';

/**
 * Everything the server needs from the core banking database, behind one
 * interface so the rules can be tested without SQL Server.
 */

export interface Officer {
  id: string; // FieldOfficerID as text
  staffId: string;
  fullName: string;
  branchCode: string;
  passwordHash: string | null;
  active: boolean;
}

export type DepositKind = 'SAVINGS' | 'SHARES';

/** One account a banker can take a deposit into: a savings account or a share holding. */
export interface AccountOption {
  id: number;
  number: string;
  productCode: string;
  productName: string;
  balance: string;
}

export interface MemberAccounts {
  savings: AccountOption[];
  shares: AccountOption[];
}

export interface MemberRow {
  code: string;
  fullName: string;
  phone: string | null;
  statusCode: string;
  isActive: boolean;
  /** Lowest-id active savings account, as the first version of the app expects. */
  savingsAccountId: number | null;
  savingsBalance: string | null;
  /** Only the accounts a deposit can go into today. */
  accounts: MemberAccounts;
}

/** A savings account or share holding, with what the eligibility rules need. */
export interface AccountInfo {
  kind: DepositKind;
  accountId: number;
  customerCode: string;
  branchCode: string;
  /** SavingsAccount.AccountStatus or ShareHolding.ShareStatus. */
  accountStatus: string;
  currentBalance: string;
  customerActive: boolean;
  customerStatusCode: string;
  /** DateClosed is set. */
  isClosed?: boolean;
  isDormant?: boolean;
  productCode?: string;
  productName?: string;
  /** False when the product is switched off (or missing). */
  productActive?: boolean;
  /** Product deposit/purchase limits; null or "0.00" mean no limit. */
  minAmount?: string | null;
  maxAmount?: string | null;
}

export interface DepositInput {
  officer: Officer;
  kind: DepositKind;
  /** The app's localTransactionId. The repo adds the core's idempotency prefix. */
  reference: string;
  customerCode: string;
  accountId: number;
  amount: string;
  collectedAt: Date;
  branchCode: string;
  productCode: string;
}

export type InsertOutcome =
  | { kind: 'CREATED'; id: number }
  | { kind: 'EXISTS'; depositKind: DepositKind; id: number; customerCode: string; accountId: number; amount: string };

export interface DepositRow {
  kind: DepositKind;
  id: number;
  /** The app's original transaction id (prefix removed). */
  reference: string;
  customerCode: string;
  amount: string;
  status: string;
  createdAt: Date;
  decidedAt: Date | null;
  reason: string | null;
}

export interface SmsSettings {
  enabled: boolean;
  provider: string;
  apiKey: string;
  apiSecret: string;
  senderId: string;
  apiUrl: string;
}

export interface SmsRecipient {
  /** Normalised 0XXXXXXXXX, or null when the member has no usable mobile number. */
  phone: string | null;
  /** CustomerAlertPreferences.SMSAlerts = 0. */
  optedOut: boolean;
  firstName: string;
  fullName: string;
}

export interface SmsLogEntry {
  phone: string;
  message: string;
  status: 'SENT' | 'FAILED';
  recipientName: string;
  customerCode: string;
  referenceNo: string;
  branchCode: string;
  userId: string;
  error: string | null;
  apiResponse: string;
  sentAt: Date;
}

/** A member type the registration form offers (CustomerType). */
export interface MemberTypeRow {
  code: string;
  description: string;
}

/** Another member who already has the ID number, phone or email being registered. */
export interface MemberConflict {
  /** Plain label: "Ghana Card", "Phone", "Email". */
  label: string;
  value: string;
  memberCode: string;
  memberName: string;
}

export interface MemberLookup {
  ids: IdValues;
  phone?: string;
  email?: string;
}

export interface Repo {
  /** Which optional rules and features this database supports (shown under GET /health). */
  describeSchema?(): Record<string, boolean>;
  findOfficer(username: string): Promise<Officer | null>;
  getOfficer(id: string): Promise<Officer | null>;
  listMembers(branchCode: string, afterCode: number, limit: number): Promise<MemberRow[]>;
  getAccount(kind: DepositKind, accountId: number): Promise<AccountInfo | null>;
  insertDeposit(input: DepositInput): Promise<InsertOutcome>;
  listDeposits(officerId: string, since: Date | null, limit: number): Promise<DepositRow[]>;
  pendingTotals(officerId: string): Promise<{ count: number; amount: string }>;
  // Pending-deposit text message support (reads the core's own SMS settings and history).
  getSmsSettings(): Promise<SmsSettings>;
  getSmsRecipient(customerCode: string): Promise<SmsRecipient>;
  hasSmsLog(referenceNo: string, messageType: string): Promise<boolean>;
  logSms(messageType: string, entry: SmsLogEntry): Promise<void>;
  // Member registration
  listMemberTypes(): Promise<MemberTypeRow[]>;
  /** Members that already hold one of these IDs, phone numbers or email addresses. */
  findMemberConflicts(lookup: MemberLookup): Promise<MemberConflict[]>;
  /** The member this banker already registered from the same details recently, so a retry returns the same member. */
  findEarlierRegistration(officer: Officer, body: RegistrationBody): Promise<string | null>;
  /** Creates the pending member and everything that belongs to them in one transaction. Returns the new member code. */
  registerMember(officer: Officer, body: RegistrationBody): Promise<{ memberCode: string }>;
}
