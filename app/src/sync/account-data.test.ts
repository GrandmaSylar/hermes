import { ApiError } from '@/data/api/contract';
import { MockApi } from '@/data/api/mock';
import { createNodeSqlite } from '@/test/node-sqlite';
import { createFakeFiles } from '@/test/fake-files';
import { createMemoryRepos } from '@/test/memory-repos';
import { signInToMock } from '@/test/sign-in';
import { migrate } from '@/data/db/migrations';
import { pickDbName } from '@/data/db/db-names';
import { createSqliteRepos } from '@/data/db/sqlite-repos';
import { readPendingFavorites, setFavorite, syncFavorites, toImportedDeposit, toImportedRegistration } from './account-data';
import { syncOnce } from './engine';

/** The officer's favourites and history follow them: kept on the server, filled in on any phone that signs in. */

async function setup() {
  const api = new MockApi({ memberCount: 20 });
  const session = await signInToMock(api);
  const repos = createMemoryRepos();
  const fake = createFakeFiles({});
  await syncOnce({ repos, api, session, files: fake.store });
  const codes = [...repos.members.rows.keys()];
  return { api, session, repos, fake, codes };
}

describe('favourites', () => {
  test('a favourite chosen on one phone shows on another phone after it signs in', async () => {
    const { api, session, repos, fake, codes } = await setup();
    await setFavorite(repos, codes[0], true);
    await setFavorite(repos, codes[1], true);
    await syncOnce({ repos, api, session, files: fake.store });
    expect([...api.favoriteCodes].sort()).toEqual([codes[0], codes[1]].sort());

    // A second phone: nothing on it yet, same account.
    const other = createMemoryRepos();
    await syncOnce({ repos: other, api, session, files: fake.store });
    expect(await other.members.favoriteCodes()).toEqual([codes[0], codes[1]].sort());
  });

  test('un-starring on one phone removes it from the other', async () => {
    const { api, session, repos, fake, codes } = await setup();
    await setFavorite(repos, codes[0], true);
    await syncOnce({ repos, api, session, files: fake.store });
    const other = createMemoryRepos();
    await syncOnce({ repos: other, api, session, files: fake.store });
    await setFavorite(other, codes[0], false);
    await syncOnce({ repos: other, api, session, files: fake.store });
    await syncOnce({ repos, api, session, files: fake.store });
    expect(await repos.members.favoriteCodes()).toEqual([]);
  });

  test('a choice made offline waits, and is not overwritten by the older list from the server', async () => {
    const { api, session, repos, codes } = await setup();
    api.favoriteCodes.add(codes[2]);
    await setFavorite(repos, codes[0], true);
    const down = async () => {
      throw new ApiError('NETWORK', 'down');
    };
    await expect(syncFavorites(repos, { pullFavorites: async () => [codes[2]], setFavorite: down })).rejects.toMatchObject({ kind: 'NETWORK' });
    expect(await repos.members.favoriteCodes()).toEqual([codes[0]]);
    expect(await readPendingFavorites(repos.kv)).toEqual({ [codes[0]]: true });

    await syncFavorites(repos, { pullFavorites: () => api.pullFavorites({} as never), setFavorite: (c, on) => api.setFavorite({} as never, c, on) });
    expect(await repos.members.favoriteCodes()).toEqual([codes[0], codes[2]].sort());
    expect(await readPendingFavorites(repos.kv)).toEqual({});
  });

  test('favourites a phone already had before the server kept them are offered once, and later removals stick', async () => {
    const { api, session, repos, fake, codes } = await setup();
    // A phone that updated the app: members and a favourite chosen long ago, never queued, no sync with this feature yet.
    const legacy = createMemoryRepos();
    await legacy.members.upsertMany([...repos.members.rows.values()]);
    await legacy.members.setMyCustomer(codes[3], true);
    await syncOnce({ repos: legacy, api, session, files: fake.store });
    expect(api.favoriteCodes.has(codes[3])).toBe(true);
    // Removed on another phone: this phone must follow, not offer it again.
    api.favoriteCodes.delete(codes[3]);
    await syncOnce({ repos: legacy, api, session, files: fake.store });
    expect(await legacy.members.favoriteCodes()).toEqual([]);
    expect(api.favoriteCodes.has(codes[3])).toBe(false);
  });

  test('favourites for members that arrive later are applied when they do', async () => {
    const { api, session, repos, fake } = await setup();
    api.favoriteCodes.add('999999999');
    await syncOnce({ repos, api, session, files: fake.store });
    expect(await repos.members.favoriteCodes()).toEqual([]);
  });
});

describe('history on a new phone', () => {
  test('deposits and registered members the server has are added, once, with the office outcome', async () => {
    const { api, session, fake, codes } = await setup();
    api.priorDeposits.push(
      { localTransactionId: 'old-1', serverId: '501', kind: 'SAVINGS', memberCode: codes[0], amount: '120.50', status: 'APPROVED', createdAt: '2026-11-20T09:00:00.000Z', decidedAt: '2026-11-20T15:00:00.000Z', reason: null },
      { localTransactionId: 'old-2', serverId: 'SH7', kind: 'SHARES', memberCode: codes[1], amount: '40.00', status: 'REJECTED', createdAt: '2026-11-21T09:00:00.000Z', decidedAt: null, reason: 'Wrong account' },
      { localTransactionId: 'old-3', serverId: '503', kind: 'SAVINGS', memberCode: codes[0], amount: '5.00', status: 'WEIRD', createdAt: '2026-11-21T10:00:00.000Z', decidedAt: null, reason: null },
    );
    api.priorRegistrations.push({ memberCode: '1000009999', firstName: 'Abena', lastName: 'Owusu', phone: '0244000000', sex: 'Female', birthDate: '1990-01-01', status: 'PND', createdAt: '2026-11-19T10:00:00.000Z' });

    const fresh = createMemoryRepos();
    const first = await syncOnce({ repos: fresh, api, session, files: fake.store });
    expect(first.activityImported).toBe(3);
    const deposits = await fresh.outbox.list(10);
    expect(deposits.map((d) => [d.localTransactionId, d.status, d.officeStatus, d.productType])).toEqual(
      expect.arrayContaining([
        ['old-1', 'SYNCED', 'APPROVED', 'SAVINGS_DEPOSIT'],
        ['old-2', 'SYNCED', 'REJECTED', 'SHARE_CONTRIBUTION'],
      ]),
    );
    expect(deposits.find((d) => d.localTransactionId === 'old-2')?.officeReason).toBe('Wrong account');
    expect(deposits.find((d) => d.localTransactionId === 'old-3')).toBeUndefined();
    expect(deposits.find((d) => d.localTransactionId === 'old-1')?.memberName).toBe(fresh.members.rows.get(codes[0])?.name);
    const regs = await fresh.registrations.list(10);
    expect(regs).toHaveLength(1);
    expect(regs[0]).toMatchObject({ firstName: 'Abena', lastName: 'Owusu', serverId: '1000009999', status: 'SYNCED', gender: 'F' });

    // The next sync finds nothing new, and never doubles anything.
    const second = await syncOnce({ repos: fresh, api, session, files: fake.store });
    expect(second.activityImported).toBe(0);
    expect(await fresh.outbox.list(10)).toHaveLength(2);
    expect(await fresh.registrations.list(10)).toHaveLength(1);
  });

  test('a deposit made on this phone is not added twice when the server lists it', async () => {
    const { api, session, repos, fake, codes } = await setup();
    await repos.outbox.enqueue({
      localTransactionId: 'mine-1', memberCode: codes[0], memberName: 'X', productType: 'SAVINGS_DEPOSIT', amount: '10.00', reference: null,
      collectedAt: '2026-11-26T09:00:00.000Z', createdAt: '2026-11-26T09:00:00.000Z', accountId: 1, accountLabel: null, paymentMode: 'CASH',
    });
    api.priorDeposits.push({ localTransactionId: 'mine-1', serverId: '9', kind: 'SAVINGS', memberCode: codes[0], amount: '10.00', status: 'PENDING', createdAt: '2026-11-26T09:00:00.000Z', decidedAt: null, reason: null });
    await syncOnce({ repos, api, session, files: fake.store });
    expect((await repos.outbox.list(10)).filter((d) => d.localTransactionId === 'mine-1')).toHaveLength(1);
  });

  test('a member not on the phone is named by number, and unknown statuses are skipped', () => {
    const d = { localTransactionId: 'a', serverId: '1', kind: 'SAVINGS' as const, memberCode: '77', amount: '1.00', status: 'PENDING', createdAt: '2026-11-20T09:00:00.000Z', decidedAt: null, reason: null };
    expect(toImportedDeposit(d, null)?.memberName).toBe('Member 77');
    expect(toImportedDeposit({ ...d, status: 'POSTED' }, null)).toBeNull();
    expect(toImportedRegistration({ memberCode: '1', firstName: '', lastName: '', phone: '', sex: 'male', birthDate: null, status: 'PND', createdAt: '2026-11-20T09:00:00.000Z' })).toMatchObject({ gender: 'M', firstName: 'Member' });
    expect(toImportedRegistration({ memberCode: '1', firstName: 'A', lastName: 'B', phone: '', sex: '', birthDate: null, status: 'PND', createdAt: null })).toBeNull();
  });
});

describe('importing into the phone database', () => {
  async function fresh() {
    const db = createNodeSqlite();
    await migrate(db);
    return createSqliteRepos(db);
  }

  test('server deposits are kept once and show as delivered with their outcome', async () => {
    const repos = await fresh();
    const item = { localTransactionId: 'x1', memberCode: '5', memberName: 'Ama Mensah', productType: 'SAVINGS_DEPOSIT' as const, amount: '20.00', collectedAt: '2026-11-20T09:00:00.000Z', serverId: '12', officeStatus: 'APPROVED' as const, officeReason: null, officeDecidedAt: '2026-11-20T12:00:00.000Z' };
    expect(await repos.outbox.importDeposits([item, item])).toBe(1);
    expect(await repos.outbox.importDeposits([item])).toBe(0);
    const [saved] = await repos.outbox.list(10);
    expect(saved).toMatchObject({ status: 'SYNCED', officeStatus: 'APPROVED', serverId: '12', memberName: 'Ama Mensah' });
    expect((await repos.outbox.inRange('2026-11-20', '2026-11-20')).map((i) => i.localTransactionId)).toEqual(['x1']);
    // Not waiting to send, so it can never be pushed again.
    expect(await repos.outbox.due(10)).toEqual([]);
  });

  test('server registrations are kept once per member number', async () => {
    const repos = await fresh();
    const reg = { serverId: '1000009999', firstName: 'Abena', lastName: 'Owusu', gender: 'F' as const, dateOfBirth: '1990-01-01', phone: '0244000000', capturedAt: '2026-11-19T10:00:00.000Z' };
    expect(await repos.registrations.importRegistrations([reg])).toBe(1);
    expect(await repos.registrations.importRegistrations([reg])).toBe(0);
    const [saved] = await repos.registrations.list(10);
    expect(saved).toMatchObject({ status: 'SYNCED', serverId: '1000009999', payload: null });
    expect(await repos.registrations.due(10)).toEqual([]);
  });

  test('favourites are set as a whole', async () => {
    const repos = await fresh();
    await repos.members.upsertMany(
      ['1', '2', '3'].map((c) => ({ memberCode: c, name: `M${c}`, phone: '', status: 'ACTIVE' as const, branchCode: '1', balances: { savings: '0.00', shares: null, loan: null }, asOf: '2026-11-20T09:00:00.000Z', savingsAccountId: null, accounts: { savings: [], shares: [] } })),
    );
    await repos.members.setFavorites(['1', '3', '999']);
    expect(await repos.members.favoriteCodes()).toEqual(['1', '3']);
    await repos.members.setFavorites(['2']);
    expect(await repos.members.favoriteCodes()).toEqual(['2']);
  });
});

describe('one database per account on a phone', () => {
  test('each officer gets a file of their own, and the same one every time', () => {
    const a = pickDbName({}, '1004', false);
    expect(a.name).toBe('qss-1004.db');
    const b = pickDbName(a.map, '1006', false);
    expect(b.name).toBe('qss-1006.db');
    expect(pickDbName(b.map, '1004', false).name).toBe('qss-1004.db');
  });

  test('the officer already signed in before this change keeps the old file, so nothing unsent is lost', () => {
    const first = pickDbName({}, '1004', true);
    expect(first.name).toBe('qss.db');
    // Someone else signing in later does not take it.
    expect(pickDbName(first.map, '1006', true).name).toBe('qss-1006.db');
  });

  test('odd characters never reach a file name', () => {
    expect(pickDbName({}, '../x y', false).name).toBe('qss-xy.db');
  });
});
