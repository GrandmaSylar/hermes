import { DEFAULT_MEMBER_TYPES, EMPTY_FORM, toPayload, type RegistrationPayload } from '@/domain/registration';
import { createNodeSqlite } from '@/test/node-sqlite';
import { validForm } from '@/test/registration-form';
import { migrate } from './migrations';
import { createSqliteRepos } from './sqlite-repos';

/** Registrations on a real SQLite: the stored form, and finding an ID that is already on the phone. */

const item = (id: string, payload: RegistrationPayload | null) => ({
  localRegistrationId: id,
  firstName: 'Samuel',
  lastName: 'Akuffo',
  gender: 'M' as const,
  dateOfBirth: '1990-01-01',
  phone: '0244123456',
  idType: 'NATIONAL_ID',
  idNumber: payload?.nationalId ?? '',
  address: 'Kasoa',
  capturedAt: '2026-11-25T11:00:00.000Z',
  createdAt: '2026-11-25T11:00:00.000Z',
  payload,
});

const make = (form = validForm()) =>
  toPayload(form, 'reg-1', '2026-11-25T11:00:00.000Z', DEFAULT_MEMBER_TYPES, new Date('2026-11-25T12:00:00.000Z'));

async function fresh() {
  const db = createNodeSqlite();
  await migrate(db);
  return { db, repos: createSqliteRepos(db) };
}

describe('registrations on SQLite', () => {
  test('the whole form survives being stored, and older rows read back with no form', async () => {
    const { repos } = await fresh();
    await repos.registrations.enqueue(item('reg-1', make()));
    await repos.registrations.enqueue(item('old-1', null));
    const list = await repos.registrations.list(10);
    const saved = list.find((r) => r.localRegistrationId === 'reg-1')!;
    expect(saved.payload).toMatchObject({
      firstName: 'Samuel',
      nationalId: 'GHA-123456789-0',
      region: 'Central',
      beneficiaries: [{ name: 'Ama Akuffo', percentage: 100 }],
    });
    expect(list.find((r) => r.localRegistrationId === 'old-1')!.payload).toBeNull();
  });

  test("any of the member's own four IDs is found, but a guardian's ID is not", async () => {
    const { repos } = await fresh();
    const form = validForm({
      memberType: 'KID',
      birthDate: '2018-03-01',
      nationalId: '',
      voterIdNo: 'AB1234567',
      passportNo: 'G7654321',
      guardian: { ...EMPTY_FORM.guardian, name: 'Kofi Boateng', nationalId: 'GHA-555555555-5', phone: '0201234567' },
    });
    await repos.registrations.enqueue(item('reg-1', make(form)));
    expect(await repos.registrations.hasIdNumber('AB1234567')).toBe(true);
    expect(await repos.registrations.hasIdNumber('G7654321')).toBe(true);
    expect(await repos.registrations.hasIdNumber('GHA-555555555-5')).toBe(false);
    expect(await repos.registrations.hasIdNumber('AB123')).toBe(false);
    // A refused registration no longer holds its IDs.
    await repos.registrations.applyResult('reg-1', 'REJECTED', { lastError: 'no' });
    expect(await repos.registrations.hasIdNumber('AB1234567')).toBe(false);
  });

  test('a database from before the form was stored gains the column and keeps its registrations', async () => {
    const db = createNodeSqlite();
    await db.execAsync(`
      CREATE TABLE members (member_code TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL, status TEXT NOT NULL,
        branch_code TEXT NOT NULL, savings TEXT NOT NULL, shares TEXT NOT NULL, loan TEXT NOT NULL, as_of TEXT NOT NULL,
        search_text TEXT NOT NULL, my_customer INTEGER NOT NULL DEFAULT 0, collect_count INTEGER NOT NULL DEFAULT 0, savings_account_id INTEGER);
      CREATE TABLE outbox (local_txn_id TEXT PRIMARY KEY NOT NULL, member_code TEXT NOT NULL, member_name TEXT NOT NULL,
        product_type TEXT NOT NULL, amount TEXT NOT NULL, reference TEXT, collected_at TEXT NOT NULL, status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, server_id TEXT, created_at TEXT NOT NULL, account_id INTEGER,
        office_status TEXT, office_reason TEXT, office_decided_at TEXT, account_label TEXT, payment_mode TEXT NOT NULL DEFAULT 'CASH');
      CREATE TABLE registrations (local_reg_id TEXT PRIMARY KEY NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
        gender TEXT NOT NULL, date_of_birth TEXT NOT NULL, phone TEXT NOT NULL, id_type TEXT NOT NULL, id_number TEXT NOT NULL,
        address TEXT NOT NULL, captured_at TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT, server_id TEXT, created_at TEXT NOT NULL);
      CREATE TABLE member_accounts (member_code TEXT NOT NULL, kind TEXT NOT NULL, account_id INTEGER NOT NULL, number TEXT NOT NULL,
        product_code TEXT NOT NULL, product_name TEXT NOT NULL, balance TEXT NOT NULL, PRIMARY KEY (member_code, kind, account_id));
      CREATE TABLE kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      INSERT INTO registrations VALUES ('r0','Ama','Mensah','F','1990-04-23','0241234567','GHANA_CARD','GHA-123456789-0','Kasoa',
        '2026-11-01T00:00:00.000Z','PENDING',0,NULL,NULL,'2026-11-01T00:00:00.000Z');
      PRAGMA user_version = 5;
    `);
    await migrate(db);
    const [old] = await createSqliteRepos(db).registrations.list(10);
    expect(old).toMatchObject({ localRegistrationId: 'r0', firstName: 'Ama', payload: null });
    expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: 6 });
  });
});
