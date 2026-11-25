import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, test } from 'vitest';
import { buildApp, mapMemberStatus } from '../src/app';
import type { Config } from '../src/config';
import { decimalText, fromMinor, toMinor } from '../src/money';
import { MemoryRepo } from './memory-repo';

const NOW = new Date('2026-11-25T12:00:00.000Z');

const config: Config = {
  port: 0,
  host: '127.0.0.1',
  jwtSecret: 'x'.repeat(40),
  accessTtlSeconds: 1800,
  refreshTtlSeconds: 43200,
  db: { server: '', port: 0, database: '', user: '', password: '', encrypt: false, trustServerCertificate: true },
  limits: { maxSingleAmount: '5000.00', maxUnsyncedAmount: '50000.00', maxUnsyncedItems: 200 },
  maxBackdateDays: 7,
  pinMaxAttempts: 3,
  pinLockoutMinutes: 15,
  smsPendingEnabled: false,
};

let repo: MemoryRepo;

function setup() {
  repo = new MemoryRepo();
  repo.officers = [
    { id: '1006', staffId: 'mabel', fullName: 'Mabel', branchCode: '100', passwordHash: bcrypt.hashSync('1234', 4), active: true },
    { id: '1007', staffId: 'festus', fullName: 'Festus', branchCode: '100', passwordHash: bcrypt.hashSync('9999', 4), active: true },
    { id: '1008', staffId: 'gone', fullName: 'Gone', branchCode: '100', passwordHash: bcrypt.hashSync('1111', 4), active: false },
    { id: '1009', staffId: 'nopin', fullName: 'No Pin', branchCode: '100', passwordHash: null, active: true },
  ];
  repo.members = [
    { code: '10', fullName: 'Ama', phone: null, statusCode: 'ACT', isActive: true, savingsAccountId: 500, savingsBalance: '100.00', accounts: { savings: [], shares: [] } },
    { code: '11', fullName: 'Kofi', phone: null, statusCode: 'INACT', isActive: true, savingsAccountId: 501, savingsBalance: '5.00', accounts: { savings: [], shares: [] } },
    { code: '12', fullName: 'Esi', phone: null, statusCode: 'ACT', isActive: true, savingsAccountId: 502, savingsBalance: '0.00', accounts: { savings: [], shares: [] } },
  ];
  repo.accounts = [
    { kind: 'SAVINGS', accountId: 500, customerCode: '10', branchCode: '100', accountStatus: 'ACTIVE', currentBalance: '100.00', customerActive: true, customerStatusCode: 'ACT' },
    { kind: 'SAVINGS', accountId: 501, customerCode: '11', branchCode: '100', accountStatus: 'ACTIVE', currentBalance: '5.00', customerActive: true, customerStatusCode: 'INACT' },
    { kind: 'SAVINGS', accountId: 502, customerCode: '12', branchCode: '200', accountStatus: 'ACTIVE', currentBalance: '0.00', customerActive: true, customerStatusCode: 'ACT' },
    { kind: 'SAVINGS', accountId: 503, customerCode: '10', branchCode: '100', accountStatus: 'DORMANT', currentBalance: '0.00', customerActive: true, customerStatusCode: 'ACT' },
  ];
  return buildApp({ config, repo, now: () => NOW });
}

async function signIn(app: ReturnType<typeof buildApp>, username = 'mabel', pin = '1234') {
  const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username, pin, deviceId: 'device-0001' } });
  return res;
}

async function token(app: ReturnType<typeof buildApp>, username = 'mabel', pin = '1234') {
  const res = await signIn(app, username, pin);
  return `Bearer ${res.json().accessToken}`;
}

const deposit = (over: Record<string, unknown> = {}) => ({
  localTransactionId: 'txn-00000001',
  memberCode: '10',
  accountId: 500,
  amount: '25.00',
  collectedAt: '2026-11-25T11:00:00.000Z',
  ...over,
});

describe('sign-in', () => {
  let app: ReturnType<typeof buildApp>;
  beforeEach(() => {
    app = setup();
  });

  test('a correct PIN gives tokens, the banker and the limits', async () => {
    const res = await signIn(app);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.officer).toMatchObject({ id: '1006', staffId: 'mabel', branchCode: '100' });
    expect(body.limits.maxSingleAmount).toBe('5000.00');
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  test('wrong PIN, unknown user, disabled user and a user with no PIN all look the same', async () => {
    const messages = new Set<string>();
    for (const [u, p] of [['mabel', '0000'], ['nobody', '1234'], ['gone', '1111'], ['nopin', '1234']]) {
      const res = await signIn(app, u, p);
      expect(res.statusCode).toBe(401);
      messages.add(res.json().message);
    }
    expect(messages.size).toBe(1);
  });

  test('locks the account after repeated failures, even for the right PIN', async () => {
    for (let i = 0; i < 3; i++) await signIn(app, 'mabel', 'bad');
    const res = await signIn(app, 'mabel', '1234');
    expect(res.statusCode).toBe(429);
    expect(res.json().message).toMatch(/Try again in/);
  });

  test('a refresh token renews the session; an access token cannot be used to refresh', async () => {
    const first = (await signIn(app)).json();
    const ok = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: first.refreshToken } });
    expect(ok.statusCode).toBe(200);
    const bad = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: first.accessToken } });
    expect(bad.statusCode).toBe(401);
  });

  test('requests without a valid token are refused', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/members' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/members', headers: { authorization: 'Bearer junk' } })).statusCode).toBe(401);
  });

  test('disabling a banker in the core system cuts off a live session at once', async () => {
    const auth = await token(app);
    repo.officers.find((o) => o.id === '1006')!.active = false;
    const res = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: auth } });
    expect(res.statusCode).toBe(401);
  });
});

describe('members', () => {
  test('are paged with a cursor and carry the savings account id', async () => {
    const app = setup();
    const auth = await token(app);
    const first = (await app.inject({ method: 'GET', url: '/v1/members?limit=2', headers: { authorization: auth } })).json();
    expect(first.items).toHaveLength(2);
    expect(first.items[0]).toMatchObject({ code: '10', status: 'ACTIVE', savingsAccountId: 500, savingsBalance: '100.00' });
    expect(first.items[1].status).toBe('INACTIVE');
    expect(first.nextCursor).toBe('11');
    const second = (await app.inject({ method: 'GET', url: `/v1/members?limit=2&cursor=${first.nextCursor}`, headers: { authorization: auth } })).json();
    expect(second.items.map((m: { code: string }) => m.code)).toEqual(['12']);
    expect(second.nextCursor).toBeNull();
  });

  test('status codes from the core system map to the three the app knows', () => {
    expect(mapMemberStatus('ACT', true)).toBe('ACTIVE');
    expect(mapMemberStatus('INACT', true)).toBe('INACTIVE');
    expect(mapMemberStatus('NEW', true)).toBe('PENDING');
    expect(mapMemberStatus('ACT', false)).toBe('INACTIVE');
    expect(mapMemberStatus('', true)).toBe('INACTIVE');
  });
});

describe('deposits', () => {
  let app: ReturnType<typeof buildApp>;
  let auth: string;
  beforeEach(async () => {
    app = setup();
    auth = await token(app);
  });
  const post = (payload: unknown, authorization = auth) =>
    app.inject({ method: 'POST', url: '/v1/deposits', headers: { authorization }, payload: payload as object });

  test('a good deposit is stored as pending for the office, and posts nothing', async () => {
    const res = await post(deposit());
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: 'ACCEPTED', localTransactionId: 'txn-00000001' });
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]).toMatchObject({ status: 'PENDING', officerId: '1006', accountId: 500, amount: '25.00', branch: '100' });
    // Nothing here changes the member's balance.
    expect(repo.accounts[0].currentBalance).toBe('100.00');
  });

  test('sending the same deposit again returns the same record once', async () => {
    const a = (await post(deposit())).json();
    const res = await post(deposit());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'DUPLICATE', serverId: a.serverId });
    expect(repo.rows).toHaveLength(1);
  });

  test('re-using an id for a different deposit is a conflict and stores nothing new', async () => {
    await post(deposit());
    const res = await post(deposit({ amount: '30.00' }));
    expect(res.statusCode).toBe(409);
    expect(res.json().status).toBe('CONFLICT');
    expect(repo.rows).toHaveLength(1);
  });

  test('two bankers may use the same local id without clashing', async () => {
    await post(deposit());
    const other = await token(app, 'festus', '9999');
    const res = await post(deposit(), other);
    expect(res.statusCode).toBe(201);
    expect(repo.rows).toHaveLength(2);
  });

  test.each([
    ['zero', { amount: '0.00' }, /greater than zero/],
    ['over the single limit', { amount: '5000.01' }, /cannot exceed GHS 5000.00/],
    ['an account of another member', { accountId: 501 }, /does not belong/],
    ['a member in another branch', { memberCode: '12', accountId: 502 }, /not in your branch/],
    ['an inactive member', { memberCode: '11', accountId: 501 }, /not active/],
    ['an inactive account', { accountId: 503 }, /account is not active/],
    ['an unknown account', { accountId: 9999 }, /does not belong/],
    ['a time too far ahead', { collectedAt: '2026-11-27T12:00:00.000Z' }, /future/],
    ['a collection that is too old', { collectedAt: '2026-11-10T12:00:00.000Z' }, /days old/],
  ])('rejects %s with a reason and stores nothing', async (_name, over, reason) => {
    const res = await post(deposit(over));
    expect(res.statusCode).toBe(422);
    expect(res.json().status).toBe('REJECTED');
    expect(res.json().reason).toMatch(reason);
    expect(repo.rows).toHaveLength(0);
  });

  test('malformed input is a 400, not a database call', async () => {
    for (const bad of [{ amount: '12.345' }, { amount: '-5' }, { amount: 'abc' }, { localTransactionId: 'x' }, { memberCode: 'abc' }, { accountId: '500' }]) {
      const res = await post(deposit(bad));
      expect(res.statusCode).toBe(400);
    }
    expect(repo.rows).toHaveLength(0);
  });

  test('a banker sees only their own submissions', async () => {
    await post(deposit());
    const other = await token(app, 'festus', '9999');
    await post(deposit({ localTransactionId: 'txn-00000002', amount: '7.00' }), other);
    const mine = (await app.inject({ method: 'GET', url: '/v1/deposits', headers: { authorization: auth } })).json();
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]).toMatchObject({ localTransactionId: 'txn-00000001', status: 'PENDING', amount: '25.00' });
    const me = (await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: auth } })).json();
    expect(me.pendingApproval).toEqual({ count: 1, amount: '25.00' });
  });
});

describe('money helpers', () => {
  test('convert exactly', () => {
    expect(toMinor('12.5')).toBe(1250n);
    expect(fromMinor(1250n)).toBe('12.50');
    expect(decimalText('0.1')).toBe('0.10');
    expect(decimalText(null)).toBe('0.00');
    expect(() => toMinor('1.234')).toThrow();
  });
});
