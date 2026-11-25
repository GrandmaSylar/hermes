import { toMinor } from '../src/money';
import type { AccountInfo, DepositInput, DepositRow, InsertOutcome, MemberRow, Officer, Repo } from '../src/repo';

/** An in-memory stand-in for the core database, with the same duplicate rule as the real index. */
export class MemoryRepo implements Repo {
  officers: Officer[] = [];
  members: MemberRow[] = [];
  accounts: AccountInfo[] = [];
  rows: (DepositRow & { officerId: string; accountId: number; branch: string })[] = [];
  private next = 1000;

  async findOfficer(username: string) {
    return this.officers.find((o) => o.staffId === username) ?? null;
  }
  async getOfficer(id: string) {
    return this.officers.find((o) => o.id === id) ?? null;
  }
  async listMembers(branchCode: string, afterCode: number, limit: number) {
    return this.members
      .filter((m) => Number(m.code) > afterCode)
      .sort((a, b) => Number(a.code) - Number(b.code))
      .slice(0, limit);
  }
  async getAccount(id: number) {
    return this.accounts.find((a) => a.savingsAccountId === id) ?? null;
  }
  async insertDeposit(input: DepositInput): Promise<InsertOutcome> {
    const existing = this.rows.find((r) => r.reference === input.reference && r.officerId === input.officer.id);
    if (existing) {
      return { kind: 'EXISTS', id: existing.id, customerCode: existing.customerCode, savingsAccountId: existing.accountId, amount: existing.amount };
    }
    const id = this.next++;
    this.rows.push({
      id,
      reference: input.reference,
      customerCode: input.customerCode,
      amount: input.amount,
      status: 'PENDING',
      createdAt: new Date(),
      decidedAt: null,
      reason: null,
      officerId: input.officer.id,
      accountId: input.savingsAccountId,
      branch: input.branchCode,
    });
    return { kind: 'CREATED', id };
  }
  async listDeposits(officerId: string, _since: Date | null, limit: number) {
    return this.rows.filter((r) => r.officerId === officerId).slice(0, limit);
  }
  async pendingTotals(officerId: string) {
    const pending = this.rows.filter((r) => r.officerId === officerId && r.status === 'PENDING');
    const total = pending.reduce((s, r) => s + toMinor(r.amount), 0n);
    return { count: pending.length, amount: `${total / 100n}.${String(total % 100n).padStart(2, '0')}` };
  }
}
