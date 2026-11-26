import type * as SQLite from 'expo-sqlite';
import type { OfficeDecision, SavingsAccountInfo, ServerMember } from '@/data/api/contract';
import type { FileToSend, KvRepo, MemberRepo, NewOutboxItem, NewRegistration, OutboxRepo, RegistrationRepo, Repos, ImportedDeposit, ImportedRegistration } from '@/data/repositories';
import type { UnsyncedTotals } from '@/domain/capture';
import type { RegistrationFile, RegistrationItem } from '@/domain/registration';
import { queryWords } from '@/domain/member-search';
import { toMinor } from '@/domain/money';
import type { AccountOption, Member, MemberAccounts, OfficeStatus, OutboxItem, OutboxStatus, PaymentMode, ProductType } from '@/domain/types';

interface MemberRow {
  member_code: string;
  name: string;
  phone: string;
  status: Member['status'];
  branch_code: string;
  savings: string;
  shares: string;
  loan: string;
  as_of: string;
  my_customer: number;
  collect_count: number;
  savings_account_id: number | null;
}

interface AccountRow {
  member_code: string;
  kind: 'SAVINGS' | 'SHARES';
  account_id: number;
  number: string;
  product_code: string;
  product_name: string;
  balance: string;
}

interface OutboxRow {
  local_txn_id: string;
  member_code: string;
  member_name: string;
  product_type: ProductType;
  amount: string;
  reference: string | null;
  collected_at: string;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  server_id: string | null;
  created_at: string;
  account_id: number | null;
  office_status: OfficeStatus | null;
  office_reason: string | null;
  office_decided_at: string | null;
  account_label: string | null;
  payment_mode: PaymentMode;
}

/**
 * The members table keeps shares and loan as NOT NULL text. An empty string
 * means "the core did not supply it", which the app shows as not available.
 */
const balanceOut = (value: string | null): string => value ?? '';
const balanceIn = (value: string): string | null => (value === '' ? null : value);

const toMember = (row: MemberRow, accounts: MemberAccounts): Member => ({
  memberCode: row.member_code,
  name: row.name,
  phone: row.phone,
  status: row.status,
  branchCode: row.branch_code,
  balances: { savings: row.savings, shares: balanceIn(row.shares), loan: balanceIn(row.loan) },
  asOf: row.as_of,
  savingsAccountId: row.savings_account_id,
  accounts,
  myCustomer: row.my_customer === 1,
  collectCount: row.collect_count,
});

const toOutbox = (row: OutboxRow): OutboxItem => ({
  localTransactionId: row.local_txn_id,
  memberCode: row.member_code,
  memberName: row.member_name,
  productType: row.product_type,
  amount: row.amount,
  reference: row.reference,
  collectedAt: row.collected_at,
  status: row.status,
  attempts: row.attempts,
  lastError: row.last_error,
  serverId: row.server_id,
  createdAt: row.created_at,
  accountId: row.account_id,
  officeStatus: row.office_status,
  officeReason: row.office_reason,
  officeDecidedAt: row.office_decided_at,
  accountLabel: row.account_label,
  paymentMode: row.payment_mode ?? 'CASH',
});

/** Escapes LIKE wildcards so user input is matched literally. */
const likeEscape = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

const toAccountOption = (row: AccountRow): AccountOption => ({
  id: row.account_id,
  number: row.number,
  productCode: row.product_code,
  productName: row.product_name,
  balance: row.balance,
});

/** Rows per IN (...) list. Far below SQLite's limit on bound parameters. */
const ACCOUNT_CHUNK = 200;

class SqliteMemberRepo implements MemberRepo {
  constructor(private readonly db: SQLite.SQLiteDatabase) {}

  /** Attaches each member's accounts, read in a few chunked queries rather than one per member. */
  private async withAccounts(rows: MemberRow[]): Promise<Member[]> {
    const byMember = new Map<string, MemberAccounts>();
    for (const row of rows) byMember.set(row.member_code, { savings: [], shares: [] });
    const codes = [...byMember.keys()];
    for (let i = 0; i < codes.length; i += ACCOUNT_CHUNK) {
      const chunk = codes.slice(i, i + ACCOUNT_CHUNK);
      const found = await this.db.getAllAsync<AccountRow>(
        `SELECT * FROM member_accounts WHERE member_code IN (${chunk.map(() => '?').join(', ')}) ORDER BY account_id`,
        ...chunk,
      );
      for (const a of found) {
        const accounts = byMember.get(a.member_code);
        if (accounts) (a.kind === 'SHARES' ? accounts.shares : accounts.savings).push(toAccountOption(a));
      }
    }
    return rows.map((row) => toMember(row, byMember.get(row.member_code) ?? { savings: [], shares: [] }));
  }

  async upsertMany(members: ServerMember[]): Promise<void> {
    if (members.length === 0) return;
    // my_customer and collect_count are local; a refresh must never reset them.
    // A member refresh with no account id keeps the one already known.
    const statement = await this.db.prepareAsync(`
      INSERT INTO members (member_code, name, phone, status, branch_code, savings, shares, loan, as_of, search_text, savings_account_id)
      VALUES ($code, $name, $phone, $status, $branch, $savings, $shares, $loan, $asOf, $search, $account)
      ON CONFLICT(member_code) DO UPDATE SET
        name = excluded.name, phone = excluded.phone, status = excluded.status,
        branch_code = excluded.branch_code, savings = excluded.savings, shares = excluded.shares,
        loan = excluded.loan, as_of = excluded.as_of, search_text = excluded.search_text,
        savings_account_id = COALESCE(excluded.savings_account_id, savings_account_id)
    `);
    const clearAccounts = await this.db.prepareAsync('DELETE FROM member_accounts WHERE member_code = $code');
    const addAccount = await this.db.prepareAsync(`
      INSERT OR REPLACE INTO member_accounts (member_code, kind, account_id, number, product_code, product_name, balance)
      VALUES ($code, $kind, $id, $number, $productCode, $productName, $balance)
    `);
    try {
      await this.db.withTransactionAsync(async () => {
        for (const m of members) {
          await statement.executeAsync({
            $code: m.memberCode,
            $name: m.name,
            $phone: m.phone,
            $status: m.status,
            $branch: m.branchCode,
            $savings: m.balances.savings,
            $shares: balanceOut(m.balances.shares),
            $loan: balanceOut(m.balances.loan),
            $account: m.savingsAccountId ?? null,
            $asOf: m.asOf,
            $search: `${m.memberCode} ${m.name} ${m.phone}`.toLowerCase(),
          });
          // The server's list is the whole truth: drop the old rows so a closed account disappears.
          await clearAccounts.executeAsync({ $code: m.memberCode });
          for (const [kind, list] of [['SAVINGS', m.accounts.savings], ['SHARES', m.accounts.shares]] as const) {
            for (const a of list) {
              await addAccount.executeAsync({
                $code: m.memberCode,
                $kind: kind,
                $id: a.id,
                $number: a.number,
                $productCode: a.productCode,
                $productName: a.productName,
                $balance: a.balance,
              });
            }
          }
        }
      });
    } finally {
      await statement.finalizeAsync();
      await clearAccounts.finalizeAsync();
      await addAccount.finalizeAsync();
    }
  }

  async search(query: string, limit: number): Promise<Member[]> {
    const words = queryWords(query);
    if (words.length === 0) {
      const rows = await this.db.getAllAsync<MemberRow>(
        'SELECT * FROM members ORDER BY name LIMIT ?',
        limit,
      );
      return this.withAccounts(rows);
    }
    // Every word must match the member's code, name, phone (formatting ignored) or an account number.
    const hay = `lower(member_code || ' ' || name || ' ' || replace(replace(replace(replace(replace(phone, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''))`;
    const perWord = `(${hay} LIKE ? ESCAPE '\\' OR member_code IN (SELECT member_code FROM member_accounts WHERE lower(number) LIKE ? ESCAPE '\\'))`;
    const first = likeEscape(words[0]);
    const params: (string | number)[] = [];
    for (const w of words) {
      const like = `%${likeEscape(w)}%`;
      params.push(like, like);
    }
    // Best matches first: exact code, code prefix, name prefix, a name word prefix; then mine; then A-Z.
    const rows = await this.db.getAllAsync<MemberRow>(
      `SELECT * FROM members
       WHERE ${words.map(() => perWord).join(' AND ')}
       ORDER BY CASE
           WHEN lower(member_code) = ? THEN 0
           WHEN lower(member_code) LIKE ? ESCAPE '\\' THEN 1
           WHEN lower(name) LIKE ? ESCAPE '\\' THEN 2
           WHEN lower(name) LIKE ? ESCAPE '\\' THEN 3
           ELSE 4 END,
         my_customer DESC, name
       LIMIT ?`,
      ...params,
      words[0],
      `${first}%`,
      `${first}%`,
      `% ${first}%`,
      limit,
    );
    return this.withAccounts(rows);
  }

  async get(memberCode: string): Promise<Member | null> {
    const row = await this.db.getFirstAsync<MemberRow>('SELECT * FROM members WHERE member_code = ?', memberCode);
    if (!row) return null;
    const [member] = await this.withAccounts([row]);
    return member;
  }

  async maxCode(): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ c: string }>('SELECT member_code AS c FROM members ORDER BY CAST(member_code AS INTEGER) DESC LIMIT 1');
    return row?.c ?? null;
  }
  async count(): Promise<number> {
    const row = await this.db.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM members');
    return row?.n ?? 0;
  }

  async applySavingsAccounts(accounts: SavingsAccountInfo[]): Promise<void> {
    if (accounts.length === 0) return;
    const statement = await this.db.prepareAsync(
      // With several accounts the lowest id wins, so the choice is stable between syncs.
      'UPDATE members SET savings_account_id = $account, savings = $balance WHERE member_code = $code AND (savings_account_id IS NULL OR savings_account_id >= $account)',
    );
    try {
      await this.db.withTransactionAsync(async () => {
        for (const a of accounts) {
          await statement.executeAsync({ $account: a.accountId, $balance: a.balance, $code: a.memberCode });
        }
      });
    } finally {
      await statement.finalizeAsync();
    }
  }

  async setMyCustomer(memberCode: string, value: boolean): Promise<void> {
    await this.db.runAsync('UPDATE members SET my_customer = ? WHERE member_code = ?', value ? 1 : 0, memberCode);
  }

  async bumpCollectCount(memberCode: string): Promise<void> {
    await this.db.runAsync('UPDATE members SET collect_count = collect_count + 1 WHERE member_code = ?', memberCode);
  }

  async mine(limit: number): Promise<Member[]> {
    const rows = await this.db.getAllAsync<MemberRow>(
      'SELECT * FROM members WHERE my_customer = 1 ORDER BY name LIMIT ?',
      limit,
    );
    return this.withAccounts(rows);
  }

  async frequent(limit: number): Promise<Member[]> {
    const rows = await this.db.getAllAsync<MemberRow>(
      'SELECT * FROM members WHERE collect_count > 0 AND my_customer = 0 ORDER BY collect_count DESC, name LIMIT ?',
      limit,
    );
    return this.withAccounts(rows);
  }
}

class SqliteOutboxRepo implements OutboxRepo {
  constructor(private readonly db: SQLite.SQLiteDatabase) {}

  async enqueue(item: NewOutboxItem): Promise<void> {
    // The primary key on local_txn_id makes a double tap harmless: the second insert is ignored.
    await this.db.runAsync(
      `INSERT OR IGNORE INTO outbox
       (local_txn_id, member_code, member_name, product_type, amount, reference, collected_at, status, attempts, created_at, account_id, account_label, payment_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?, ?, ?)`,
      item.localTransactionId,
      item.memberCode,
      item.memberName,
      item.productType,
      item.amount,
      item.reference,
      item.collectedAt,
      item.createdAt,
      item.accountId,
      item.accountLabel,
      item.paymentMode,
    );
  }

  async list(limit: number): Promise<OutboxItem[]> {
    const rows = await this.db.getAllAsync<OutboxRow>(
      'SELECT * FROM outbox ORDER BY created_at DESC LIMIT ?',
      limit,
    );
    return rows.map(toOutbox);
  }

  async due(limit: number): Promise<OutboxItem[]> {
    const rows = await this.db.getAllAsync<OutboxRow>(
      "SELECT * FROM outbox WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT ?",
      limit,
    );
    return rows.map(toOutbox);
  }

  async recoverInterrupted(): Promise<void> {
    await this.db.runAsync("UPDATE outbox SET status = 'PENDING' WHERE status = 'SENDING'");
  }

  async markSending(ids: string[]): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      for (const id of ids) {
        await this.db.runAsync(
          "UPDATE outbox SET status = 'SENDING', attempts = attempts + 1 WHERE local_txn_id = ?",
          id,
        );
      }
    });
  }

  async applyResult(
    id: string,
    status: OutboxStatus,
    patch: { serverId?: string | null; lastError?: string | null },
  ): Promise<void> {
    await this.db.runAsync(
      'UPDATE outbox SET status = ?, server_id = COALESCE(?, server_id), last_error = ? WHERE local_txn_id = ?',
      status,
      patch.serverId ?? null,
      patch.lastError ?? null,
      id,
    );
  }

  async release(ids: string[]): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      for (const id of ids) {
        await this.db.runAsync("UPDATE outbox SET status = 'PENDING' WHERE local_txn_id = ? AND status = 'SENDING'", id);
      }
    });
  }

  async unsyncedTotals(): Promise<UnsyncedTotals> {
    const rows = await this.db.getAllAsync<{ amount: string }>(
      "SELECT amount FROM outbox WHERE status IN ('PENDING', 'SENDING')",
    );
    return { count: rows.length, amountMinor: rows.reduce((sum, r) => sum + toMinor(r.amount), 0n) };
  }

  async forDay(day: string): Promise<OutboxItem[]> {
    const rows = await this.db.getAllAsync<OutboxRow>(
      'SELECT * FROM outbox WHERE substr(collected_at, 1, 10) = ? ORDER BY created_at DESC',
      day,
    );
    return rows.map(toOutbox);
  }

  async importDeposits(items: ImportedDeposit[]): Promise<number> {
    let added = 0;
    await this.db.withTransactionAsync(async () => {
      for (const i of items) {
        const result = await this.db.runAsync(
          `INSERT OR IGNORE INTO outbox
           (local_txn_id, member_code, member_name, product_type, amount, reference, collected_at, status, attempts, server_id, created_at,
            account_id, account_label, payment_mode, office_status, office_reason, office_decided_at)
           VALUES (?, ?, ?, ?, ?, NULL, ?, 'SYNCED', 0, ?, ?, NULL, NULL, 'CASH', ?, ?, ?)`,
          i.localTransactionId,
          i.memberCode,
          i.memberName,
          i.productType,
          i.amount,
          i.collectedAt,
          i.serverId,
          i.collectedAt,
          i.officeStatus,
          i.officeReason,
          i.officeDecidedAt,
        );
        added += result.changes;
      }
    });
    return added;
  }

  async inRange(fromDay: string, toDay: string): Promise<OutboxItem[]> {
    const rows = await this.db.getAllAsync<OutboxRow>(
      'SELECT * FROM outbox WHERE substr(collected_at, 1, 10) BETWEEN ? AND ? ORDER BY collected_at DESC, created_at DESC',
      fromDay,
      toDay,
    );
    return rows.map(toOutbox);
  }

  async awaitingDecision(): Promise<number> {
    const row = await this.db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM outbox WHERE status = 'SYNCED' AND (office_status IS NULL OR office_status = 'PENDING' OR office_status = 'APPROVED')",
    );
    return row?.n ?? 0;
  }

  async applyOfficeDecisions(decisions: OfficeDecision[]): Promise<number> {
    let changed = 0;
    await this.db.withTransactionAsync(async () => {
      for (const d of decisions) {
        const result = await this.db.runAsync(
          `UPDATE outbox SET office_status = ?, office_reason = ?, office_decided_at = ?
           WHERE local_txn_id = ? AND status = 'SYNCED'
             AND (office_status IS NOT ? OR office_reason IS NOT ? OR office_decided_at IS NOT ?)`,
          d.status,
          d.reason,
          d.decidedAt,
          d.localTransactionId,
          d.status,
          d.reason,
          d.decidedAt,
        );
        changed += result.changes;
      }
    });
    return changed;
  }
}

interface RegistrationRow {
  local_reg_id: string;
  first_name: string;
  last_name: string;
  gender: RegistrationItem['gender'];
  date_of_birth: string;
  phone: string;
  id_type: RegistrationItem['idType'];
  id_number: string;
  address: string;
  captured_at: string;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  server_id: string | null;
  created_at: string;
  payload: string | null;
}

interface FileRow {
  local_reg_id: string;
  kind: RegistrationFile['kind'];
  uri: string;
  name: string;
  mime_type: string;
  size: number;
  status: RegistrationFile['status'];
  attempts: number;
  last_error: string | null;
}

const toFile = (row: FileRow): RegistrationFile => ({
  kind: row.kind,
  uri: row.uri,
  name: row.name,
  mimeType: row.mime_type,
  size: row.size,
  status: row.status,
  attempts: row.attempts,
  lastError: row.last_error,
});

const toRegistration = (row: RegistrationRow, files: RegistrationFile[] = []): RegistrationItem => ({
  localRegistrationId: row.local_reg_id,
  firstName: row.first_name,
  lastName: row.last_name,
  gender: row.gender,
  dateOfBirth: row.date_of_birth,
  phone: row.phone,
  idType: row.id_type,
  idNumber: row.id_number,
  address: row.address,
  capturedAt: row.captured_at,
  status: row.status,
  attempts: row.attempts,
  lastError: row.last_error,
  serverId: row.server_id,
  createdAt: row.created_at,
  payload: parsePayload(row.payload),
  files,
});

/** The ID numbers a saved registration holds for the member themselves. */
function registeredIds(primary: string, payload: RegistrationItem['payload']): string[] {
  const own = payload ? [payload.nationalId, payload.voterIdNo, payload.nhisNo, payload.passportNo] : [];
  return [primary, ...own].filter(Boolean);
}

function parsePayload(text: string | null): RegistrationItem['payload'] {
  if (!text) return null;
  try {
    return JSON.parse(text) as RegistrationItem['payload'];
  } catch {
    return null;
  }
}

class SqliteRegistrationRepo implements RegistrationRepo {
  constructor(private readonly db: SQLite.SQLiteDatabase) {}

  async enqueue(item: NewRegistration): Promise<void> {
    // INSERT OR IGNORE on the primary key makes a double tap harmless.
    // The registration and its files are saved together, or not at all.
    await this.db.withTransactionAsync(async () => {
      const result = await this.db.runAsync(
        `INSERT OR IGNORE INTO registrations
         (local_reg_id, first_name, last_name, gender, date_of_birth, phone, id_type, id_number, address,
          captured_at, status, attempts, created_at, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)`,
        item.localRegistrationId,
        item.firstName,
        item.lastName,
        item.gender,
        item.dateOfBirth,
        item.phone,
        item.idType,
        item.idNumber,
        item.address,
        item.capturedAt,
        item.createdAt,
        item.payload ? JSON.stringify(item.payload) : null,
      );
      if (result.changes === 0) return;
      for (const f of item.files) {
        await this.db.runAsync(
          `INSERT OR IGNORE INTO registration_files (local_reg_id, kind, uri, name, mime_type, size, status, attempts)
           VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0)`,
          item.localRegistrationId,
          f.kind,
          f.uri,
          f.name,
          f.mimeType,
          f.size,
        );
      }
    });
  }

  /** The files of these registrations, grouped by registration. */
  private async withFiles(rows: RegistrationRow[]): Promise<RegistrationItem[]> {
    if (rows.length === 0) return [];
    const marks = rows.map(() => '?').join(', ');
    const files = await this.db.getAllAsync<FileRow>(
      `SELECT * FROM registration_files WHERE local_reg_id IN (${marks}) ORDER BY rowid`,
      ...rows.map((r) => r.local_reg_id),
    );
    const byId = new Map<string, RegistrationFile[]>();
    for (const f of files) byId.set(f.local_reg_id, [...(byId.get(f.local_reg_id) ?? []), toFile(f)]);
    return rows.map((r) => toRegistration(r, byId.get(r.local_reg_id) ?? []));
  }

  async filesToSend(limit: number): Promise<FileToSend[]> {
    const rows = await this.db.getAllAsync<FileRow & { server_id: string }>(
      `SELECT f.*, r.server_id AS server_id FROM registration_files f
       JOIN registrations r ON r.local_reg_id = f.local_reg_id
       WHERE f.status = 'PENDING' AND r.status = 'SYNCED' AND r.server_id IS NOT NULL AND r.server_id <> ''
       ORDER BY r.created_at ASC, f.rowid ASC LIMIT ?`,
      limit,
    );
    return rows.map((r) => ({ ...toFile(r), localRegistrationId: r.local_reg_id, memberCode: r.server_id }));
  }

  async applyFileResult(id: string, kind: RegistrationFile['kind'], status: 'SENT' | 'REJECTED', lastError?: string | null): Promise<void> {
    await this.db.runAsync(
      'UPDATE registration_files SET status = ?, attempts = attempts + 1, last_error = ? WHERE local_reg_id = ? AND kind = ?',
      status,
      lastError ?? null,
      id,
      kind,
    );
  }

  async abandonFiles(id: string, reason: string): Promise<RegistrationFile[]> {
    const rows = await this.db.getAllAsync<FileRow>("SELECT * FROM registration_files WHERE local_reg_id = ? AND status = 'PENDING'", id);
    await this.db.runAsync("UPDATE registration_files SET status = 'REJECTED', last_error = ? WHERE local_reg_id = ? AND status = 'PENDING'", reason, id);
    return rows.map(toFile);
  }

  async list(limit: number): Promise<RegistrationItem[]> {
    const rows = await this.db.getAllAsync<RegistrationRow>(
      'SELECT * FROM registrations ORDER BY created_at DESC LIMIT ?',
      limit,
    );
    return this.withFiles(rows);
  }

  async due(limit: number): Promise<RegistrationItem[]> {
    const rows = await this.db.getAllAsync<RegistrationRow>(
      "SELECT * FROM registrations WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT ?",
      limit,
    );
    return this.withFiles(rows);
  }

  async recoverInterrupted(): Promise<void> {
    await this.db.runAsync("UPDATE registrations SET status = 'PENDING' WHERE status = 'SENDING'");
  }

  async markSending(ids: string[]): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      for (const id of ids) {
        await this.db.runAsync(
          "UPDATE registrations SET status = 'SENDING', attempts = attempts + 1 WHERE local_reg_id = ?",
          id,
        );
      }
    });
  }

  async applyResult(
    id: string,
    status: OutboxStatus,
    patch: { serverId?: string | null; lastError?: string | null },
  ): Promise<void> {
    await this.db.runAsync(
      'UPDATE registrations SET status = ?, server_id = COALESCE(?, server_id), last_error = ? WHERE local_reg_id = ?',
      status,
      patch.serverId ?? null,
      patch.lastError ?? null,
      id,
    );
  }

  async release(ids: string[]): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      for (const id of ids) {
        await this.db.runAsync(
          "UPDATE registrations SET status = 'PENDING' WHERE local_reg_id = ? AND status = 'SENDING'",
          id,
        );
      }
    });
  }

  async waitingCount(): Promise<number> {
    const row = await this.db.getFirstAsync<{ n: number }>(
      "SELECT count(*) AS n FROM registrations WHERE status IN ('PENDING', 'SENDING')",
    );
    return row?.n ?? 0;
  }

  async hasIdNumber(idNumber: string): Promise<boolean> {
    // A cheap filter in SQL, then the exact check: the member's own four IDs, never the guardian's.
    const like = `%${idNumber.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await this.db.getAllAsync<{ id_number: string; payload: string | null }>(
      "SELECT id_number, payload FROM registrations WHERE status <> 'REJECTED' AND (id_number = ? OR payload LIKE ? ESCAPE '\\')",
      idNumber,
      like,
    );
    return rows.some((r) => registeredIds(r.id_number, parsePayload(r.payload)).includes(idNumber));
  }

  async forDay(day: string): Promise<RegistrationItem[]> {
    const rows = await this.db.getAllAsync<RegistrationRow>(
      'SELECT * FROM registrations WHERE substr(captured_at, 1, 10) = ? ORDER BY created_at DESC',
      day,
    );
    return this.withFiles(rows);
  }

  async importRegistrations(items: ImportedRegistration[]): Promise<number> {
    let added = 0;
    await this.db.withTransactionAsync(async () => {
      for (const i of items) {
        const known = await this.db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM registrations WHERE server_id = ?', i.serverId);
        if (known && known.n > 0) continue;
        const result = await this.db.runAsync(
          `INSERT OR IGNORE INTO registrations
           (local_reg_id, first_name, last_name, gender, date_of_birth, phone, id_type, id_number, address,
            captured_at, status, attempts, server_id, created_at, payload)
           VALUES (?, ?, ?, ?, ?, ?, 'NATIONAL_ID', '', '', ?, 'SYNCED', 0, ?, ?, NULL)`,
          `server-${i.serverId}`,
          i.firstName,
          i.lastName,
          i.gender,
          i.dateOfBirth,
          i.phone,
          i.capturedAt,
          i.serverId,
          i.capturedAt,
        );
        added += result.changes;
      }
    });
    return added;
  }

  async inRange(fromDay: string, toDay: string): Promise<RegistrationItem[]> {
    const rows = await this.db.getAllAsync<RegistrationRow>(
      'SELECT * FROM registrations WHERE substr(captured_at, 1, 10) BETWEEN ? AND ? ORDER BY captured_at DESC, created_at DESC',
      fromDay,
      toDay,
    );
    return this.withFiles(rows);
  }
}

class SqliteKvRepo implements KvRepo {
  constructor(private readonly db: SQLite.SQLiteDatabase) {}

  async get(key: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.runAsync(
      'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }
}

export function createSqliteRepos(db: SQLite.SQLiteDatabase): Repos {
  return {
    members: new SqliteMemberRepo(db),
    outbox: new SqliteOutboxRepo(db),
    registrations: new SqliteRegistrationRepo(db),
    kv: new SqliteKvRepo(db),
  };
}
