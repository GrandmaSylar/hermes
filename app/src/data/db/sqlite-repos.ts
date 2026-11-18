import type * as SQLite from 'expo-sqlite';
import type { ServerMember } from '@/data/api/contract';
import type {
  KvRepo,
  MemberRepo,
  NewOutboxItem,
  NewRegistration,
  OutboxRepo,
  RegistrationRepo,
  Repos,
} from '@/data/repositories';
import type { UnsyncedTotals } from '@/domain/capture';
import type { RegistrationItem } from '@/domain/registration';
import { toMinor } from '@/domain/money';
import type { Member, OutboxItem, OutboxStatus, ProductType } from '@/domain/types';

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
}

const toMember = (row: MemberRow): Member => ({
  memberCode: row.member_code,
  name: row.name,
  phone: row.phone,
  status: row.status,
  branchCode: row.branch_code,
  balances: { savings: row.savings, shares: row.shares, loan: row.loan },
  asOf: row.as_of,
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
});

/** Escapes LIKE wildcards so user input is matched literally. */
const likeEscape = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

class SqliteMemberRepo implements MemberRepo {
  constructor(private readonly db: SQLite.SQLiteDatabase) {}

  async upsertMany(members: ServerMember[]): Promise<void> {
    if (members.length === 0) return;
    // my_customer and collect_count are local; a refresh must never reset them.
    const statement = await this.db.prepareAsync(`
      INSERT INTO members (member_code, name, phone, status, branch_code, savings, shares, loan, as_of, search_text)
      VALUES ($code, $name, $phone, $status, $branch, $savings, $shares, $loan, $asOf, $search)
      ON CONFLICT(member_code) DO UPDATE SET
        name = excluded.name, phone = excluded.phone, status = excluded.status,
        branch_code = excluded.branch_code, savings = excluded.savings, shares = excluded.shares,
        loan = excluded.loan, as_of = excluded.as_of, search_text = excluded.search_text
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
            $shares: m.balances.shares,
            $loan: m.balances.loan,
            $asOf: m.asOf,
            $search: `${m.memberCode} ${m.name} ${m.phone}`.toLowerCase(),
          });
        }
      });
    } finally {
      await statement.finalizeAsync();
    }
  }

  async search(query: string, limit: number): Promise<Member[]> {
    const q = query.trim().toLowerCase();
    if (q === '') {
      const rows = await this.db.getAllAsync<MemberRow>(
        'SELECT * FROM members ORDER BY name LIMIT ?',
        limit,
      );
      return rows.map(toMember);
    }
    const escaped = likeEscape(q);
    const rows = await this.db.getAllAsync<MemberRow>(
      `SELECT * FROM members
       WHERE search_text LIKE ? ESCAPE '\\'
       ORDER BY (member_code LIKE ? ESCAPE '\\' OR lower(name) LIKE ? ESCAPE '\\') DESC, name
       LIMIT ?`,
      `%${escaped}%`,
      `${escaped}%`,
      `${escaped}%`,
      limit,
    );
    return rows.map(toMember);
  }

  async get(memberCode: string): Promise<Member | null> {
    const row = await this.db.getFirstAsync<MemberRow>('SELECT * FROM members WHERE member_code = ?', memberCode);
    return row ? toMember(row) : null;
  }

  async count(): Promise<number> {
    const row = await this.db.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM members');
    return row?.n ?? 0;
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
    return rows.map(toMember);
  }

  async frequent(limit: number): Promise<Member[]> {
    const rows = await this.db.getAllAsync<MemberRow>(
      'SELECT * FROM members WHERE collect_count > 0 AND my_customer = 0 ORDER BY collect_count DESC, name LIMIT ?',
      limit,
    );
    return rows.map(toMember);
  }
}

class SqliteOutboxRepo implements OutboxRepo {
  constructor(private readonly db: SQLite.SQLiteDatabase) {}

  async enqueue(item: NewOutboxItem): Promise<void> {
    // The primary key on local_txn_id makes a double tap harmless: the second insert is ignored.
    await this.db.runAsync(
      `INSERT OR IGNORE INTO outbox
       (local_txn_id, member_code, member_name, product_type, amount, reference, collected_at, status, attempts, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?)`,
      item.localTransactionId,
      item.memberCode,
      item.memberName,
      item.productType,
      item.amount,
      item.reference,
      item.collectedAt,
      item.createdAt,
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
}

const toRegistration = (row: RegistrationRow): RegistrationItem => ({
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
});

class SqliteRegistrationRepo implements RegistrationRepo {
  constructor(private readonly db: SQLite.SQLiteDatabase) {}

  async enqueue(item: NewRegistration): Promise<void> {
    // INSERT OR IGNORE on the primary key makes a double tap harmless.
    await this.db.runAsync(
      `INSERT OR IGNORE INTO registrations
       (local_reg_id, first_name, last_name, gender, date_of_birth, phone, id_type, id_number, address,
        captured_at, status, attempts, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?)`,
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
    );
  }

  async list(limit: number): Promise<RegistrationItem[]> {
    const rows = await this.db.getAllAsync<RegistrationRow>(
      'SELECT * FROM registrations ORDER BY created_at DESC LIMIT ?',
      limit,
    );
    return rows.map(toRegistration);
  }

  async due(limit: number): Promise<RegistrationItem[]> {
    const rows = await this.db.getAllAsync<RegistrationRow>(
      "SELECT * FROM registrations WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT ?",
      limit,
    );
    return rows.map(toRegistration);
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
    const row = await this.db.getFirstAsync<{ n: number }>(
      "SELECT count(*) AS n FROM registrations WHERE id_number = ? AND status <> 'REJECTED'",
      idNumber,
    );
    return (row?.n ?? 0) > 0;
  }

  async forDay(day: string): Promise<RegistrationItem[]> {
    const rows = await this.db.getAllAsync<RegistrationRow>(
      'SELECT * FROM registrations WHERE substr(captured_at, 1, 10) = ? ORDER BY created_at DESC',
      day,
    );
    return rows.map(toRegistration);
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
