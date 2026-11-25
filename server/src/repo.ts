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

export interface MemberRow {
  code: string;
  fullName: string;
  phone: string | null;
  statusCode: string;
  isActive: boolean;
  savingsAccountId: number | null;
  savingsBalance: string | null;
}

export interface AccountInfo {
  savingsAccountId: number;
  customerCode: string;
  branchCode: string;
  accountStatus: string;
  currentBalance: string;
  customerActive: boolean;
  customerStatusCode: string;
}

export interface DepositInput {
  officer: Officer;
  reference: string;
  customerCode: string;
  savingsAccountId: number;
  amount: string;
  collectedAt: Date;
  branchCode: string;
}

export type InsertOutcome =
  | { kind: 'CREATED'; id: number }
  | { kind: 'EXISTS'; id: number; customerCode: string; savingsAccountId: number; amount: string };

export interface DepositRow {
  id: number;
  reference: string;
  customerCode: string;
  amount: string;
  status: string;
  createdAt: Date;
  decidedAt: Date | null;
  reason: string | null;
}

export interface Repo {
  findOfficer(username: string): Promise<Officer | null>;
  getOfficer(id: string): Promise<Officer | null>;
  listMembers(branchCode: string, afterCode: number, limit: number): Promise<MemberRow[]>;
  getAccount(savingsAccountId: number): Promise<AccountInfo | null>;
  insertDeposit(input: DepositInput): Promise<InsertOutcome>;
  listDeposits(officerId: string, since: Date | null, limit: number): Promise<DepositRow[]>;
  pendingTotals(officerId: string): Promise<{ count: number; amount: string }>;
}
