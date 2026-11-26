import { DocumentError } from '../src/mssql-documents';
import type { CheckedDocument } from '../src/documents';
import { toMinor } from '../src/money';
import { originalReference, REF_PREFIX, storedReference } from '../src/reference';
import type { RegistrationBody } from '../src/registration';
import type {
  AccountInfo,
  DepositInput,
  DepositKind,
  BranchInfo,
  DepositRow,
  InsertOutcome,
  MemberConflict,
  MemberLookup,
  MemberRow,
  MemberTypeRow,
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
  /** Registration is on by default; a test turns it off to see the switched-off behaviour. */
  registrationEnabled = true;
  documentsEnabled = true;
  /** KYC files saved by saveMemberDocument, one per member and kind. Members in `approved` are no longer pending. */
  documents = new Map<string, CheckedDocument>();
  approved = new Set<string>();
  memberTypes: MemberTypeRow[] = [
    { code: 'IND', description: 'INDIVIDUAL' },
    { code: 'KID', description: 'KIDDY SAVINGS' },
    { code: 'JNT', description: 'JOINT' },
  ];
  /** Members created by registerMember, with who made them and when. */
  registered: { memberCode: string; by: string; body: RegistrationBody; branchCode: string }[] = [];
  /** Members that already exist, for the duplicate checks. */
  existing: { code: string; name: string; nationalId?: string; voterIdNo?: string; nhisNo?: string; passportNo?: string; phone?: string; email?: string }[] = [];

  describeSchema() {
    return { sharesEnabled: true, registrationEnabled: this.registrationEnabled, documentsEnabled: this.documentsEnabled };
  }
  async listMemberTypes() {
    return this.memberTypes;
  }
  async findMemberConflicts(lookup: MemberLookup): Promise<MemberConflict[]> {
    const out: MemberConflict[] = [];
    const all = [
      ...this.existing,
      ...this.registered.map((r) => ({
        code: r.memberCode,
        name: `${r.body.firstName} ${r.body.lastName}`,
        nationalId: r.body.nationalId,
        voterIdNo: r.body.voterIdNo,
        nhisNo: r.body.nhisNo,
        passportNo: r.body.passportNo,
        phone: r.body.phone,
        email: r.body.email,
      })),
    ];
    const fields = [
      ['Ghana Card', 'nationalId', lookup.ids.nationalId],
      ['Voter ID', 'voterIdNo', lookup.ids.voterIdNo],
      ['NHIS card', 'nhisNo', lookup.ids.nhisNo],
      ['Passport', 'passportNo', lookup.ids.passportNo],
    ] as const;
    for (const [label, key, value] of fields) {
      if (!value) continue;
      const m = all.find((x) => (x[key] ?? '').toUpperCase() === value.toUpperCase());
      if (m) out.push({ label, value, memberCode: m.code, memberName: m.name });
    }
    if (lookup.phone) {
      const m = all.find((x) => x.phone && x.phone.replace(/\s/g, '') === lookup.phone!.replace(/\s/g, ''));
      if (m) out.push({ label: 'Phone', value: lookup.phone, memberCode: m.code, memberName: m.name });
    }
    if (lookup.email) {
      const m = all.find((x) => x.email && x.email.toLowerCase() === lookup.email!.toLowerCase());
      if (m) out.push({ label: 'Email', value: lookup.email, memberCode: m.code, memberName: m.name });
    }
    return out;
  }
  async findEarlierRegistration(officer: Officer, body: RegistrationBody) {
    const r = this.registered.find(
      (x) => x.by === officer.staffId && x.body.firstName === body.firstName && x.body.lastName === body.lastName && x.body.birthDate === body.birthDate,
    );
    return r?.memberCode ?? null;
  }
  async registerMember(officer: Officer, body: RegistrationBody) {
    const memberCode = `${officer.branchCode.padStart(3, '0')}${String(4000 + this.registered.length).padStart(7, '0')}`;
    this.registered.push({ memberCode, by: officer.staffId, body, branchCode: officer.branchCode });
    return { memberCode };
  }

  async saveMemberDocument(officer: Officer, memberCode: string, doc: CheckedDocument) {
    const member = this.registered.find((r) => r.memberCode === memberCode && r.by === officer.staffId);
    if (!member) throw new DocumentError(404, 'That member was not found.');
    if (this.approved.has(memberCode)) throw new DocumentError(409, 'This member has already been approved, so documents can no longer be added from the phone.');
    this.documents.set(`${memberCode}:${doc.kind}`, doc);
  }

  async findOfficer(username: string) {
    return this.officers.find((o) => o.staffId === username) ?? null;
  }
  async getOfficer(id: string) {
    return this.officers.find((o) => o.id === id) ?? null;
  }
  branch: BranchInfo | null = { code: '001', name: 'Techiman Branch', city: 'Techiman', creditUnion: 'Test Credit Union' };
  async getBranchInfo(_branchCode: string) {
    return this.branch;
  }
  logo: { version: string; dataUri: string } | null = { version: 'v1', dataUri: 'data:image/png;base64,AAAA' };
  async getLogo(_branchCode: string) {
    return this.logo;
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
