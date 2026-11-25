import type { ServerMember } from '@/data/api/contract';
import { MockApi } from '@/data/api/mock';
import type { AccountOption, MemberAccounts } from '@/domain/types';
import { createNodeSqlite } from '@/test/node-sqlite';
import { signInToMock } from '@/test/sign-in';
import { captureCollection } from '@/sync/capture';
import { syncOnce } from '@/sync/engine';
import { SCHEMA_VERSION, migrate } from './migrations';
import { createSqliteRepos } from './sqlite-repos';

/**
 * These run the app's real migration and repository SQL on a real SQLite
 * (Node's), through a small adapter for the expo-sqlite API. See
 * src/test/node-sqlite.ts for what that does and does not prove.
 */

/** The schema exactly as version 4 shipped it. Frozen: never edit it to follow later migrations. */
const SCHEMA_V4 = `
  CREATE TABLE members (
    member_code TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL, status TEXT NOT NULL,
    branch_code TEXT NOT NULL, savings TEXT NOT NULL, shares TEXT NOT NULL, loan TEXT NOT NULL,
    as_of TEXT NOT NULL, search_text TEXT NOT NULL, my_customer INTEGER NOT NULL DEFAULT 0,
    collect_count INTEGER NOT NULL DEFAULT 0, savings_account_id INTEGER
  );
  CREATE TABLE outbox (
    local_txn_id TEXT PRIMARY KEY NOT NULL, member_code TEXT NOT NULL, member_name TEXT NOT NULL,
    product_type TEXT NOT NULL, amount TEXT NOT NULL, reference TEXT, collected_at TEXT NOT NULL,
    status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, server_id TEXT,
    created_at TEXT NOT NULL, account_id INTEGER, office_status TEXT, office_reason TEXT, office_decided_at TEXT
  );
  CREATE TABLE registrations (
    local_reg_id TEXT PRIMARY KEY NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL, gender TEXT NOT NULL,
    date_of_birth TEXT NOT NULL, phone TEXT NOT NULL, id_type TEXT NOT NULL, id_number TEXT NOT NULL,
    address TEXT NOT NULL, captured_at TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT, server_id TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  PRAGMA user_version = 4;
`;

const acct = (id: number, number: string, productName: string, balance: string): AccountOption => ({
  id,
  number,
  productCode: number.split('-')[1] ?? '',
  productName,
  balance,
});

const serverMember = (code: string, accounts: MemberAccounts, over: Partial<ServerMember> = {}): ServerMember => ({
  memberCode: code,
  name: `Member ${code}`,
  phone: '0240000000',
  status: 'ACTIVE',
  branchCode: '100',
  balances: { savings: '10.00', shares: null, loan: null },
  asOf: '2026-11-20T00:00:00.000Z',
  savingsAccountId: accounts.savings[0]?.id ?? null,
  accounts,
  ...over,
});

describe('migration', () => {
  test('a new database is created at the current version', async () => {
    const db = createNodeSqlite();
    await migrate(db);
    expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: SCHEMA_VERSION });
    expect(SCHEMA_VERSION).toBe(6);
    const tables = (await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(['members', 'outbox', 'registrations', 'kv', 'member_accounts']));
  });

  test('version 4 data survives: members keep their savings account, outbox rows keep working with no label', async () => {
    const db = createNodeSqlite();
    await db.execAsync(SCHEMA_V4);
    await db.runAsync(
      `INSERT INTO members (member_code, name, phone, status, branch_code, savings, shares, loan, as_of, search_text, my_customer, collect_count, savings_account_id)
       VALUES ('100001', 'Ama Mensah', '0241234567', 'ACTIVE', '100', '55.50', '', '', '2026-11-18T00:00:00.000Z', '100001 ama mensah 0241234567', 1, 4, 500001),
              ('100002', 'Kofi Owusu', '0247654321', 'ACTIVE', '100', '0.00', '', '', '2026-11-18T00:00:00.000Z', '100002 kofi owusu 0247654321', 0, 0, NULL)`,
    );
    await db.runAsync(
      `INSERT INTO outbox (local_txn_id, member_code, member_name, product_type, amount, reference, collected_at, status, attempts, created_at, account_id, office_status)
       VALUES ('old-1', '100001', 'Ama Mensah', 'SAVINGS_DEPOSIT', '40.00', NULL, '2026-11-18T08:00:00.000Z', 'SYNCED', 1, '2026-11-18T08:00:00.000Z', 500001, 'APPROVED')`,
    );
    await db.runAsync("INSERT INTO kv (key, value) VALUES ('members.pulledAt', '2026-11-18T00:00:00.000Z')");

    await migrate(db);

    expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: 6 });
    const repos = createSqliteRepos(db);

    const ama = await repos.members.get('100001');
    expect(ama).toMatchObject({ name: 'Ama Mensah', myCustomer: true, collectCount: 4, savingsAccountId: 500001 });
    expect(ama?.balances.savings).toBe('55.50');
    // The one account the phone already knew is offered until the next refresh brings the full list.
    expect(ama?.accounts.savings).toEqual([{ id: 500001, number: '500001', productCode: '', productName: 'Savings', balance: '55.50' }]);
    expect(ama?.accounts.shares).toEqual([]);
    // A member with no known account gets none.
    expect((await repos.members.get('100002'))?.accounts).toEqual({ savings: [], shares: [] });

    const [old] = await repos.outbox.list(10);
    expect(old).toMatchObject({
      localTransactionId: 'old-1',
      amount: '40.00',
      status: 'SYNCED',
      officeStatus: 'APPROVED',
      accountId: 500001,
      accountLabel: null,
      paymentMode: 'CASH',
    });
    expect(await repos.kv.get('members.pulledAt')).toBe('2026-11-18T00:00:00.000Z');

    // Running it again changes nothing.
    await migrate(db);
    expect((await db.getAllAsync('SELECT * FROM member_accounts')).length).toBe(1);
  });
});

describe('member accounts', () => {
  const setup = async () => {
    const db = createNodeSqlite();
    await migrate(db);
    return { db, repos: createSqliteRepos(db) };
  };

  test('saves several accounts of each kind and reads them back in account order', async () => {
    const { repos } = await setup();
    await repos.members.upsertMany([
      serverMember('1001', {
        savings: [acct(500002, '1-SU', 'Susu Savings', '8.00'), acct(500001, '1-KS', 'Ordinary Savings', '120.50')],
        shares: [acct(800001, '1-SH', 'Ordinary Shares', '300.00'), acct(800002, '1-PS', 'Preference Shares', '25.25')],
      }),
    ]);
    const m = await repos.members.get('1001');
    expect(m?.accounts.savings.map((a) => [a.id, a.number, a.productName, a.balance])).toEqual([
      [500001, '1-KS', 'Ordinary Savings', '120.50'],
      [500002, '1-SU', 'Susu Savings', '8.00'],
    ]);
    expect(m?.accounts.shares.map((a) => a.id)).toEqual([800001, 800002]);
  });

  test('a refresh replaces a member\'s accounts, so a closed account disappears, and touches no one else', async () => {
    const { repos } = await setup();
    const two = { savings: [acct(1, '1-KS', 'Ordinary Savings', '1.00'), acct(2, '1-SU', 'Susu Savings', '2.00')], shares: [acct(9, '1-SH', 'Ordinary Shares', '3.00')] };
    await repos.members.upsertMany([serverMember('1001', two), serverMember('1002', { savings: [acct(7, '2-KS', 'Ordinary Savings', '7.00')], shares: [] })]);

    await repos.members.upsertMany([
      serverMember('1001', { savings: [acct(1, '1-KS', 'Ordinary Savings', '1.50')], shares: [] }),
    ]);

    const m = await repos.members.get('1001');
    expect(m?.accounts.savings).toEqual([acct(1, '1-KS', 'Ordinary Savings', '1.50')]);
    expect(m?.accounts.shares).toEqual([]);
    expect((await repos.members.get('1002'))?.accounts.savings).toHaveLength(1);
  });

  test('a refresh keeps the local flags and the collect count', async () => {
    const { repos } = await setup();
    await repos.members.upsertMany([serverMember('1001', { savings: [acct(1, '1-KS', 'Ordinary Savings', '1.00')], shares: [] })]);
    await repos.members.setMyCustomer('1001', true);
    await repos.members.bumpCollectCount('1001');
    await repos.members.upsertMany([serverMember('1001', { savings: [acct(1, '1-KS', 'Ordinary Savings', '2.00')], shares: [] }, { name: 'Renamed' })]);
    expect(await repos.members.get('1001')).toMatchObject({ name: 'Renamed', myCustomer: true, collectCount: 1 });
  });

  test('searches, mine and frequent lists carry accounts too', async () => {
    const { repos } = await setup();
    const list = [1, 2, 3].map((n) =>
      serverMember(`100${n}`, { savings: [acct(n, `${n}-KS`, 'Ordinary Savings', '1.00')], shares: n === 2 ? [acct(90 + n, `${n}-SH`, 'Ordinary Shares', '4.00')] : [] }),
    );
    await repos.members.upsertMany(list);
    await repos.members.setMyCustomer('1002', true);
    await repos.members.bumpCollectCount('1003');

    const found = await repos.members.search('100', 10);
    expect(found).toHaveLength(3);
    expect(found.map((m) => m.accounts.savings.length)).toEqual([1, 1, 1]);
    expect(found.find((m) => m.memberCode === '1002')?.accounts.shares).toHaveLength(1);
    expect((await repos.members.mine(10))[0].accounts.shares).toHaveLength(1);
    expect((await repos.members.frequent(10))[0].accounts.savings).toHaveLength(1);
  });

  describe('search', () => {
    const seed = async () => {
      const { repos } = await setup();
      await repos.members.upsertMany([
        serverMember('2001', { savings: [acct(1, '2001-KS', 'Ordinary Savings', '1.00')], shares: [] }, { name: 'Kofi Adu Mensah', phone: '024 412 3456' }),
        serverMember('2002', { savings: [acct(2, 'ACC-777', 'Ordinary Savings', '1.00')], shares: [] }, { name: 'Ama Mensah', phone: '+233201112222' }),
        serverMember('3001', { savings: [], shares: [] }, { name: 'Mensah Yaw', phone: '0553334444' }),
        serverMember('2', { savings: [], shares: [] }, { name: 'Esi 50%_off', phone: '0500000000' }),
      ]);
      return repos;
    };

    test('every word must match, in any order', async () => {
      const repos = await seed();
      expect((await repos.members.search('mensah kofi', 10)).map((m) => m.memberCode)).toEqual(['2001']);
      expect((await repos.members.search('kofi zzz', 10))).toEqual([]);
    });

    test('a phone number matches however it is typed or stored', async () => {
      const repos = await seed();
      for (const q of ['0244123456', '024 412 3456', '+233244123456', '244123456', '4123']) {
        expect((await repos.members.search(q, 10)).map((m) => m.memberCode)).toEqual(['2001']);
      }
      expect((await repos.members.search('0201112222', 10)).map((m) => m.memberCode)).toEqual(['2002']);
    });

    test('an account number finds its member', async () => {
      const repos = await seed();
      expect((await repos.members.search('acc-777', 10)).map((m) => m.memberCode)).toEqual(['2002']);
    });

    test('best matches come first: exact code, then name start, then name word, then the rest', async () => {
      const repos = await seed();
      expect((await repos.members.search('2', 10))[0].memberCode).toBe('2');
      expect((await repos.members.search('mensah', 10)).map((m) => m.memberCode)).toEqual(['3001', '2002', '2001']);
    });

    test('percent and underscore are plain characters', async () => {
      const repos = await seed();
      expect((await repos.members.search('50%_', 10)).map((m) => m.memberCode)).toEqual(['2']);
      expect(await repos.members.search('%', 10)).toHaveLength(1);
    });
  });

  test('a list longer than one chunk still gets every member\'s accounts', async () => {
    const { repos } = await setup();
    const many = Array.from({ length: 450 }, (_, i) => serverMember(String(10000 + i), { savings: [acct(i + 1, `${i}-KS`, 'Ordinary Savings', '1.00')], shares: [] }));
    await repos.members.upsertMany(many);
    const all = await repos.members.search('', 450);
    expect(all).toHaveLength(450);
    expect(all.every((m) => m.accounts.savings.length === 1)).toBe(true);
  });

  test('the legacy account pull still updates the member\'s savings figure', async () => {
    const { repos } = await setup();
    await repos.members.upsertMany([serverMember('1001', { savings: [acct(5, '1-KS', 'Ordinary Savings', '1.00')], shares: [] })]);
    await repos.members.applySavingsAccounts([{ memberCode: '1001', accountId: 5, balance: '99.00' }]);
    expect((await repos.members.get('1001'))?.balances.savings).toBe('99.00');
  });
});

describe('outbox with the account label and payment mode', () => {
  test('saves and returns the label and the payment mode', async () => {
    const db = createNodeSqlite();
    await migrate(db);
    const repos = createSqliteRepos(db);
    await repos.outbox.enqueue({
      localTransactionId: 'n-1',
      memberCode: '1001',
      memberName: 'Ama',
      productType: 'SHARE_CONTRIBUTION',
      amount: '25.00',
      reference: null,
      collectedAt: '2026-11-20T08:00:00.000Z',
      createdAt: '2026-11-20T08:00:00.000Z',
      accountId: 800001,
      accountLabel: 'Ordinary Shares · 1-SH',
      paymentMode: 'CASH',
    });
    // A second insert with the same id is ignored (double tap).
    await repos.outbox.enqueue({
      localTransactionId: 'n-1',
      memberCode: '1001',
      memberName: 'Ama',
      productType: 'SHARE_CONTRIBUTION',
      amount: '99.00',
      reference: null,
      collectedAt: '2026-11-20T08:00:00.000Z',
      createdAt: '2026-11-20T08:00:00.000Z',
      accountId: 800001,
      accountLabel: 'x',
      paymentMode: 'CASH',
    });
    const items = await repos.outbox.list(10);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ productType: 'SHARE_CONTRIBUTION', accountId: 800001, accountLabel: 'Ordinary Shares · 1-SH', paymentMode: 'CASH', amount: '25.00' });
  });
});

describe('the whole flow on the SQL repositories', () => {
  test('a savings deposit and a shares deposit, each to a chosen account, are saved, delivered with the right kind and account, and approved', async () => {
    const db = createNodeSqlite();
    await migrate(db);
    const repos = createSqliteRepos(db);
    const api = new MockApi({ memberCount: 60 });
    const session = await signInToMock(api);
    await syncOnce({ repos, api, session });

    // Member i=1 has two savings accounts (i % 4 === 1) and one share holding.
    const member = (await repos.members.get('100002'))!;
    expect(member.accounts.savings).toHaveLength(2);
    expect(member.accounts.shares).toHaveLength(1);

    let n = 0;
    const second = member.accounts.savings[1];
    const savings = await captureCollection(repos, session, { member, productType: 'SAVINGS_DEPOSIT', amount: '12.34', account: second }, () => `sql-${++n}`);
    const shares = await captureCollection(repos, session, { member, productType: 'SHARE_CONTRIBUTION', amount: '5', account: member.accounts.shares[0] }, () => `sql-${++n}`);
    expect(savings.ok && shares.ok).toBe(true);

    const pushed: { id: string; kind: string; accountId: number | null }[] = [];
    const original = api.pushTransactions.bind(api);
    api.pushTransactions = async (s, items) => {
      pushed.push(...items.map((i) => ({ id: i.localTransactionId, kind: i.kind, accountId: i.accountId })));
      return original(s, items);
    };
    const report = await syncOnce({ repos, api, session });
    expect(report).toMatchObject({ pushed: 2, accepted: 2, rejected: 0 });
    expect(pushed).toEqual([
      { id: 'sql-1', kind: 'SAVINGS', accountId: second.id },
      { id: 'sql-2', kind: 'SHARES', accountId: member.accounts.shares[0].id },
    ]);
    const stored = await repos.outbox.list(10);
    expect(stored.map((i) => i.accountLabel).sort()).toEqual([`Ordinary Shares · ${member.accounts.shares[0].number}`, `Susu Savings · ${second.number}`].sort());
    expect(stored.every((i) => i.status === 'SYNCED')).toBe(true);
  });
});
