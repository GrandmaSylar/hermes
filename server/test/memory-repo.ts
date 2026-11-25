import { toMinor } from '../src/money';
import { originalReference, REF_PREFIX, storedReference } from '../src/reference';
import type {
  AccountInfo,
  DepositInput,
  DepositKind,
  DepositRow,
  InsertOutcome,
  MemberRow,
  Officer,
  Repo,
  SmsLogEntry,
  SmsRecipient,
  SmsSettings,
} from '../src/repo';

/** An in-memory stand-in for the core database, with the same duplicate rule as the real lookup. */
export class MemoryRepo implements Repo {
  officers: Officer[] = [];
  members: MemberRow[] = [];
  accounts: AccountInfo[] = [];
  /** `reference` is the stored form (prefixed), as in the database. */
  rows: (DepositRow & { officerId: string; accountId: number; branch: string; productCode: string })[] = [];
  smsSettings: SmsSettings = { enabled: true, provider: 'arkesel', apiKey: 'k', apiSecret: '', senderId: 'QSS', apiUrl: 'http://fake' };
  recipients = new Map<string, SmsRecipient>();
  smsLog: (SmsLogEntry & { messageType: string })[] = [];
  private next = 1000;

  async findOfficer(username: string) {
    return this.officers.find((o) => o.staffId === username) ?? null;
  }
  async getOfficer(id: string) {
    return this.officers.find((o) => o.id === id) ?? null;
  }
  async listMembers(_branchCode: string, afterCode: number, limit: number) {
    return this.members
      .filter((m) => Number(m.code) > afterCode)
      .sort((a, b) => Number(a.code) - Number(b.code))
      .slice(0, limit);
  }
  async getAccount(kind: DepositKind, id: number) {
    return this.accounts.find((a) => a.kind === kind && a.accountId === id) ?? null;
  }
  async insertDeposit(input: DepositInput): Promise<InsertOutcome> {
    const bare = input.reference;
    const existing = this.rows.find(
      (r) => r.officerId === input.officer.id && (r.reference === bare || r.reference === storedReference(bare)),
    );
    if (existing) {
      return {
        kind: 'EXISTS',
        depositKind: existing.kind,
        id: existing.id,
        customerCode: existing.customerCode,
        accountId: existing.accountId,
        amount: existing.amount,
      };
    }
    const id = this.next++;
    this.rows.push({
      kind: input.kind,
      id,
      reference: storedReference(bare),
      customerCode: input.customerCode,
      amount: input.amount,
      status: 'PENDING',
      createdAt: new Date(),
      decidedAt: null,
      reason: null,
      officerId: input.officer.id,
      accountId: input.accountId,
      branch: input.branchCode,
      productCode: input.productCode,
    });
    return { kind: 'CREATED', id };
  }
  async listDeposits(officerId: string, _since: Date | null, limit: number) {
    return this.rows
      .filter((r) => r.officerId === officerId)
      .slice(0, limit)
      .map((r) => ({ ...r, reference: originalReference(r.reference) }));
  }
  async pendingTotals(officerId: string) {
    const pending = this.rows.filter((r) => r.officerId === officerId && r.status === 'PENDING');
    const total = pending.reduce((s, r) => s + toMinor(r.amount), 0n);
    return { count: pending.length, amount: `${total / 100n}.${String(total % 100n).padStart(2, '0')}` };
  }
  async getSmsSettings() {
    return this.smsSettings;
  }
  async getSmsRecipient(code: string) {
    return this.recipients.get(code) ?? { phone: null, optedOut: false, firstName: '', fullName: '' };
  }
  async hasSmsLog(referenceNo: string, messageType: string) {
    return this.smsLog.some((l) => l.referenceNo === referenceNo && l.messageType === messageType);
  }
  async logSms(messageType: string, entry: SmsLogEntry) {
    this.smsLog.push({ ...entry, messageType });
  }
}

export { REF_PREFIX };
