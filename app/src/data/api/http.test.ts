import { ApiError } from './contract';
import { HttpApi, mapMember, mapMemberStatus, messageFrom, twoDecimals } from './http';
import type { Session } from '@/domain/types';

/**
 * A fake field server. Each route is a function from the request to a status
 * and body, and every request is recorded so tests can check exactly what the
 * app sent.
 */
interface Recorded {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}
type Route = (req: Recorded) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>;

function fakeServer(routes: Record<string, Route>) {
  const calls: Recorded[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = url.replace('https://field.test', '');
    const req: Recorded = {
      method: init.method ?? 'GET',
      path,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(req);
    const key = `${req.method} ${path.split('?')[0]}`;
    const route = routes[key];
    if (!route) throw new Error(`unexpected request ${key}`);
    const answer = await route(req);
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => answer.body ?? null } as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const DEVICE = 'device-abcdef-1';

const loginOk: Route = () => ({
  status: 200,
  body: {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresInSeconds: 1800,
    officer: { id: '1006', staffId: 'mabel', fullName: 'Mabel Asare', branchCode: '100' },
    limits: { maxSingleAmount: '5000.00', maxUnsyncedAmount: '20000.00', maxUnsyncedItems: 150 },
  },
});

const session: Session = {
  officerId: '1006',
  officerName: 'Mabel Asare',
  branchCode: '100',
  deviceId: DEVICE,
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  limits: { maxUnsyncedItems: 200, maxUnsyncedAmount: '20000.00', maxSingleAmount: '5000.00' },
};

const deposit = {
  localTransactionId: 'local-0001',
  memberCode: '100001',
  productType: 'SAVINGS_DEPOSIT' as const,
  kind: 'SAVINGS' as const,
  amount: '40.00',
  reference: null,
  collectedAt: '2026-11-18T08:00:00.000Z',
  accountId: 500001,
  paymentMode: 'CASH' as const,
};

const make = (routes: Record<string, Route>) => {
  const server = fakeServer(routes);
  const tokens: { accessToken: string; refreshToken: string }[] = [];
  const api = new HttpApi({ baseUrl: 'https://field.test/', fetchImpl: server.fetchImpl, onTokens: (t) => tokens.push(t) });
  return { api, calls: server.calls, tokens };
};

describe('sign-in', () => {
  test('signs in with staff id and PIN and takes the banker and limits from the answer', async () => {
    const { api, calls } = make({ 'POST /v1/auth/login': loginOk });
    const result = await api.login(' mabel ', '1234', DEVICE);
    expect(result.kind).toBe('SIGNED_IN');
    if (result.kind !== 'SIGNED_IN') return;
    expect(result.session).toMatchObject({
      officerId: '1006',
      officerName: 'Mabel Asare',
      branchCode: '100',
      deviceId: DEVICE,
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
    });
    expect(result.session.limits).toEqual({ maxUnsyncedItems: 150, maxUnsyncedAmount: '20000.00', maxSingleAmount: '5000.00' });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ username: 'mabel', pin: '1234', deviceId: DEVICE });
  });

  test('missing limits fall back to safe defaults', async () => {
    const { api } = make({
      'POST /v1/auth/login': () => ({ status: 200, body: { accessToken: 'a', refreshToken: 'r', officer: { id: '1', fullName: 'X', branchCode: '100' } } }),
    });
    const result = await api.login('x', '1', DEVICE);
    if (result.kind !== 'SIGNED_IN') throw new Error('expected sign-in');
    expect(result.session.limits).toEqual({ maxUnsyncedItems: 200, maxUnsyncedAmount: '50000.00', maxSingleAmount: '5000.00' });
  });

  test('a wrong PIN says so plainly', async () => {
    const { api } = make({ 'POST /v1/auth/login': () => ({ status: 401, body: { message: 'Invalid credentials or account disabled.' } }) });
    await expect(api.login('mabel', '0000', DEVICE)).rejects.toMatchObject({ kind: 'AUTH', message: 'Staff ID or PIN is incorrect.' });
  });

  test('a lockout shows the server\'s own wording and is not a sign-out', async () => {
    const { api } = make({ 'POST /v1/auth/login': () => ({ status: 429, body: { message: 'Too many failed attempts. Try again in 12 minute(s).' } }) });
    await expect(api.login('mabel', '0000', DEVICE)).rejects.toMatchObject({ kind: 'SERVER', message: expect.stringMatching(/Try again in 12/) });
  });

  test('a banker with no branch is told to contact an administrator', async () => {
    const { api } = make({ 'POST /v1/auth/login': () => ({ status: 403, body: { message: 'This account has no branch. Contact an administrator.' } }) });
    await expect(api.login('mabel', '1234', DEVICE)).rejects.toThrow(/no branch/);
  });

  test('empty input is reported as a prompt, not as a bad PIN', async () => {
    const { api } = make({ 'POST /v1/auth/login': () => ({ status: 400, body: { message: 'Enter your staff ID, PIN and device id.' } }) });
    await expect(api.login('', '', DEVICE)).rejects.toMatchObject({ kind: 'AUTH', message: 'Enter your staff ID and PIN.' });
  });

  test('an answer without a session is a server problem', async () => {
    const { api } = make({ 'POST /v1/auth/login': () => ({ status: 200, body: {} }) });
    await expect(api.login('mabel', '1234', DEVICE)).rejects.toMatchObject({ kind: 'SERVER' });
  });

  test('offline is a network error', async () => {
    const { api } = make({
      'POST /v1/auth/login': () => {
        throw new TypeError('Network request failed');
      },
    });
    await expect(api.login('mabel', '1234', DEVICE)).rejects.toMatchObject({ kind: 'NETWORK' });
  });

  test('this server has no SMS code step, takes savings and shares, and hides Mobile Money', () => {
    const { api } = make({});
    expect(api.capabilities).toEqual({
      otp: false,
      registration: false,
      documents: false,
      favorites: false,
      officeDecisions: true,
      mobileMoney: false,
      shareContribution: true,
      loanRepayment: false,
    });
  });
});

describe('reading members', () => {
  test('maps members with their savings account and balance, and the cursor', async () => {
    const { api, calls } = make({
      'GET /v1/members': () => ({
        status: 200,
        body: {
          items: [
            { code: '1001', fullName: 'Ama Mensah', phone: '0241234567', status: 'ACTIVE', savingsAccountId: 500001, savingsBalance: '1234.5' },
            { code: '1002', fullName: '  Kofi Owusu ', phone: null, status: 'PENDING', savingsAccountId: null, savingsBalance: null },
            { code: '1003', fullName: 'Esi Addo', phone: null, status: 'INACTIVE', savingsAccountId: 500003, savingsBalance: '0.00' },
          ],
          nextCursor: '1003',
        },
      }),
    });
    const page = await api.pullMembers(session, '1000');
    expect(calls[0].path).toBe('/v1/members?limit=200&cursor=1000');
    expect(calls[0].headers.authorization).toBe('Bearer access-1');
    expect(page.nextCursor).toBe('1003');
    expect(page.items.map((m) => [m.memberCode, m.name, m.status, m.phone, m.savingsAccountId, m.balances.savings])).toEqual([
      ['1001', 'Ama Mensah', 'ACTIVE', '0241234567', 500001, '1234.50'],
      ['1002', 'Kofi Owusu', 'PENDING_APPROVAL', '', null, '0.00'],
      ['1003', 'Esi Addo', 'INACTIVE', '', 500003, '0.00'],
    ]);
    // Members take the signed-in banker's branch, and shares and loan are not offered.
    expect(page.items[0].branchCode).toBe('100');
    expect(page.items[0].balances).toMatchObject({ shares: null, loan: null });
  });

  test('maps several savings accounts and share holdings, and totals the balances', async () => {
    const { api } = make({
      'GET /v1/members': () => ({
        status: 200,
        body: {
          items: [
            {
              code: '1001',
              fullName: 'Ama Mensah',
              phone: '0241234567',
              status: 'ACTIVE',
              savingsAccountId: 500001,
              savingsBalance: '100.10',
              accounts: {
                savings: [
                  { id: 500001, number: '1-KS', productCode: 'KS', productName: 'Ordinary Savings', balance: '100.10' },
                  { id: 500002, number: '1-SU', productCode: 'SU', productName: 'Susu Savings', balance: '20.5' },
                ],
                shares: [{ id: 800001, number: '1-SH', productCode: 'SH', productName: 'Ordinary Shares', balance: '75.00' }],
              },
            },
            { code: '1002', fullName: 'Kofi', status: 'ACTIVE', savingsAccountId: null, savingsBalance: null, accounts: { savings: [], shares: [] } },
          ],
          nextCursor: null,
        },
      }),
    });
    const [ama, kofi] = (await api.pullMembers(session, null)).items;
    expect(ama.accounts.savings).toEqual([
      { id: 500001, number: '1-KS', productCode: 'KS', productName: 'Ordinary Savings', balance: '100.10' },
      { id: 500002, number: '1-SU', productCode: 'SU', productName: 'Susu Savings', balance: '20.50' },
    ]);
    expect(ama.accounts.shares).toHaveLength(1);
    expect(ama.accounts.shares[0]).toMatchObject({ id: 800001, productName: 'Ordinary Shares', balance: '75.00' });
    expect(ama.balances).toEqual({ savings: '120.60', shares: '75.00', loan: null });
    expect(kofi.accounts).toEqual({ savings: [], shares: [] });
  });

  test('an older server with no accounts still gives the member one savings account', async () => {
    const { api } = make({
      'GET /v1/members': () => ({
        status: 200,
        body: { items: [{ code: '1001', fullName: 'Ama', status: 'ACTIVE', savingsAccountId: 500001, savingsBalance: '12.5' }], nextCursor: null },
      }),
    });
    const [ama] = (await api.pullMembers(session, null)).items;
    expect(ama.accounts.savings).toEqual([{ id: 500001, number: '500001', productCode: '', productName: 'Savings', balance: '12.50' }]);
    expect(ama.accounts.shares).toEqual([]);
    expect(ama.balances.savings).toBe('12.50');
  });

  test('accounts without a usable id are dropped', async () => {
    const m = mapMember({ code: '1', status: 'ACTIVE', accounts: { savings: [{ id: 'x', balance: '1' }, { number: 'n' }, { id: 0 }, { id: 7, balance: '1' }], shares: 'oops' } }, 'now', '100');
    expect(m.accounts.savings.map((a) => a.id)).toEqual([7]);
    expect(m.accounts.shares).toEqual([]);
  });

  test('the last page has no cursor', async () => {
    const { api } = make({ 'GET /v1/members': () => ({ status: 200, body: { items: [], nextCursor: null } }) });
    expect((await api.pullMembers(session, null)).nextCursor).toBeNull();
  });

  test('there is no separate accounts pull: the server sends accounts with the members', async () => {
    const { api, calls } = make({});
    expect(await api.pullSavingsAccounts()).toEqual({ items: [], nextCursor: null });
    expect(calls).toHaveLength(0);
  });
});

describe('sending deposits', () => {
  const accepted: Route = () => ({ status: 201, body: { status: 'ACCEPTED', localTransactionId: 'local-0001', serverId: '898361' } });

  test('sends exactly what the server needs', async () => {
    const { api, calls } = make({ 'POST /v1/deposits': accepted });
    const [result] = await api.pushTransactions(session, [deposit]);
    expect(result).toEqual({ localTransactionId: 'local-0001', status: 'ACCEPTED', serverId: '898361' });
    expect(calls[0].body).toEqual({
      localTransactionId: 'local-0001',
      memberCode: '100001',
      accountId: 500001,
      amount: '40.00',
      collectedAt: '2026-11-18T08:00:00.000Z',
      kind: 'SAVINGS',
      paymentMode: 'CASH',
    });
  });

  test('a repeat the server already has comes back as a duplicate, not an error', async () => {
    const { api } = make({ 'POST /v1/deposits': () => ({ status: 200, body: { status: 'DUPLICATE', serverId: '898361' } }) });
    const [result] = await api.pushTransactions(session, [deposit]);
    expect(result).toEqual({ localTransactionId: 'local-0001', status: 'DUPLICATE', serverId: '898361' });
  });

  test('a shares deposit is sent as kind SHARES with the share holding id', async () => {
    const { api, calls } = make({ 'POST /v1/deposits': accepted });
    const [result] = await api.pushTransactions(session, [
      { ...deposit, localTransactionId: 'share-1', productType: 'SHARE_CONTRIBUTION', kind: 'SHARES', accountId: 800001 },
    ]);
    expect(result.status).toBe('ACCEPTED');
    expect(calls[0].body).toEqual({
      localTransactionId: 'share-1',
      kind: 'SHARES',
      memberCode: '100001',
      accountId: 800001,
      amount: '40.00',
      collectedAt: '2026-11-18T08:00:00.000Z',
      paymentMode: 'CASH',
    });
  });

  test('nothing is sent without an account, for a loan repayment, for Mobile Money, or with a kind that does not match', async () => {
    const { api, calls } = make({});
    const results = await api.pushTransactions(session, [
      { ...deposit, localTransactionId: 'a', accountId: null },
      { ...deposit, localTransactionId: 'b', productType: 'LOAN_REPAYMENT' },
      { ...deposit, localTransactionId: 'c', paymentMode: 'MOBILE_MONEY' },
      { ...deposit, localTransactionId: 'd', kind: 'SHARES' },
      { ...deposit, localTransactionId: 'e', productType: 'SHARE_CONTRIBUTION', kind: 'SHARES', accountId: null },
    ]);
    expect(results.map((r) => r.status)).toEqual(['REJECTED', 'REJECTED', 'REJECTED', 'REJECTED', 'REJECTED']);
    expect(results[2].reason).toMatch(/only cash/i);
    expect(results[4].reason).toMatch(/shares account/);
    expect(calls).toHaveLength(0);
  });

  test('a refusal carries the server\'s reason', async () => {
    const { api } = make({
      'POST /v1/deposits': () => ({ status: 422, body: { status: 'REJECTED', reason: 'This member is not in your branch.' } }),
    });
    const [result] = await api.pushTransactions(session, [deposit]);
    expect(result).toMatchObject({ status: 'REJECTED', reason: 'This member is not in your branch.' });
  });

  test('the same id with different details is a conflict, not an overwrite', async () => {
    const { api } = make({
      'POST /v1/deposits': () => ({ status: 409, body: { status: 'CONFLICT', reason: 'This transaction id was already used for a different deposit.' } }),
    });
    const [result] = await api.pushTransactions(session, [deposit]);
    expect(result).toMatchObject({ status: 'CONFLICT', reason: expect.stringMatching(/already used/) });
  });

  test('a malformed request is shown as a refusal with the server\'s message', async () => {
    const { api } = make({ 'POST /v1/deposits': () => ({ status: 400, body: { message: 'amount must have at most two decimals' } }) });
    const [result] = await api.pushTransactions(session, [deposit]);
    expect(result).toMatchObject({ status: 'REJECTED', reason: expect.stringMatching(/two decimals/) });
  });

  test('losing the connection part-way returns what was answered and leaves the rest waiting', async () => {
    let n = 0;
    const { api } = make({
      'POST /v1/deposits': () => {
        n += 1;
        if (n === 2) throw new TypeError('Network request failed');
        return { status: 201, body: { status: 'ACCEPTED', serverId: `S-${n}` } };
      },
    });
    const results = await api.pushTransactions(session, [deposit, { ...deposit, localTransactionId: 'local-0002' }, { ...deposit, localTransactionId: 'local-0003' }]);
    expect(results.map((r) => r.localTransactionId)).toEqual(['local-0001']);
  });

  test('losing the connection on the first item is a network error', async () => {
    const { api } = make({
      'POST /v1/deposits': () => {
        throw new TypeError('Network request failed');
      },
    });
    await expect(api.pushTransactions(session, [deposit])).rejects.toMatchObject({ kind: 'NETWORK' });
  });

  test('server trouble is a server error so the item stays waiting and is retried', async () => {
    const { api } = make({ 'POST /v1/deposits': () => ({ status: 500, body: { message: 'Something went wrong. Try again.' } }) });
    await expect(api.pushTransactions(session, [deposit])).rejects.toMatchObject({ kind: 'SERVER' });
  });
});

describe('office decisions', () => {
  test('maps the server statuses to the four the app shows, and keeps the reason for a refusal', async () => {
    const { api, calls } = make({
      'GET /v1/deposits': () => ({
        status: 200,
        body: {
          items: [
            { serverId: '1', localTransactionId: 'a-0000001', status: 'PENDING', decidedAt: null, reason: null },
            { serverId: '2', localTransactionId: 'b-0000002', status: 'APPROVED', decidedAt: '2026-11-25T10:00:00.000Z', reason: null },
            { serverId: '3', localTransactionId: 'c-0000003', status: 'VERIFIED', decidedAt: '2026-11-25T17:00:00.000Z', reason: null },
            { serverId: '4', localTransactionId: 'd-0000004', status: 'REJECTED', decidedAt: '2026-11-25T11:00:00.000Z', reason: 'Wrong amount.' },
            { serverId: '5', localTransactionId: 'e-0000005', status: 'REVERSED', decidedAt: null, reason: null },
            { serverId: '6', localTransactionId: '', status: 'APPROVED', decidedAt: null, reason: null },
            { serverId: '7', localTransactionId: 'g-0000007', status: 'approved', decidedAt: null, reason: 'ignored for non-refusals' },
          ],
        },
      }),
    });
    const decisions = await api.pullDecisions(session, '2026-11-25T09:00:00.000Z');
    expect(calls[0].path).toBe('/v1/deposits?limit=500&since=2026-11-25T09%3A00%3A00.000Z');
    expect(decisions).toEqual([
      { localTransactionId: 'a-0000001', status: 'PENDING', decidedAt: null, reason: null },
      { localTransactionId: 'b-0000002', status: 'APPROVED', decidedAt: '2026-11-25T10:00:00.000Z', reason: null },
      { localTransactionId: 'c-0000003', status: 'VERIFIED', decidedAt: '2026-11-25T17:00:00.000Z', reason: null },
      { localTransactionId: 'd-0000004', status: 'REJECTED', decidedAt: '2026-11-25T11:00:00.000Z', reason: 'Wrong amount.' },
      { localTransactionId: 'g-0000007', status: 'APPROVED', decidedAt: null, reason: null },
    ]);
  });

  test('without a time it asks for the latest', async () => {
    const { api, calls } = make({ 'GET /v1/deposits': () => ({ status: 200, body: { items: [] } }) });
    expect(await api.pullDecisions(session, null)).toEqual([]);
    expect(calls[0].path).toBe('/v1/deposits?limit=500');
  });
});

describe('session renewal', () => {
  test('an expired session is renewed once and the request repeated', async () => {
    let first = true;
    const { api, calls, tokens } = make({
      'POST /v1/deposits': (req) => {
        if (first) {
          first = false;
          return { status: 401, body: { message: 'Sign in again.' } };
        }
        expect(req.headers.authorization).toBe('Bearer access-2');
        return { status: 201, body: { status: 'ACCEPTED', serverId: 'S-9' } };
      },
      'POST /v1/auth/refresh': () => ({ status: 200, body: { accessToken: 'access-2', refreshToken: 'refresh-2' } }),
    });
    const [result] = await api.pushTransactions(session, [deposit]);
    expect(result.status).toBe('ACCEPTED');
    expect(calls.map((c) => c.path)).toEqual(['/v1/deposits', '/v1/auth/refresh', '/v1/deposits']);
    expect(calls[1].body).toEqual({ refreshToken: 'refresh-1' });
    // The new tokens are handed back so the app can store them.
    expect(tokens).toEqual([{ accessToken: 'access-2', refreshToken: 'refresh-2' }]);
  });

  test('two calls that expire together share one renewal', async () => {
    let refreshes = 0;
    let stale = 2;
    const { api } = make({
      'GET /v1/members': () => {
        if (stale > 0) {
          stale -= 1;
          return { status: 401 };
        }
        return { status: 200, body: { items: [] } };
      },
      'POST /v1/auth/refresh': async () => {
        refreshes += 1;
        return { status: 200, body: { accessToken: 'access-2', refreshToken: 'refresh-2' } };
      },
    });
    await Promise.all([api.pullMembers(session, null), api.pullMembers(session, null)]);
    expect(refreshes).toBe(1);
  });

  test('a banker disabled in the core system must sign in again', async () => {
    const { api } = make({
      'GET /v1/members': () => ({ status: 401, body: { message: 'Account disabled or changed. Sign in again.' } }),
      'POST /v1/auth/refresh': () => ({ status: 401, body: { message: 'Account disabled.' } }),
    });
    await expect(api.pullMembers(session, null)).rejects.toMatchObject({ kind: 'AUTH' });
  });

  test('being offline while renewing is a network problem, not a sign-out', async () => {
    const { api } = make({
      'GET /v1/members': () => ({ status: 401 }),
      'POST /v1/auth/refresh': () => {
        throw new TypeError('Network request failed');
      },
    });
    await expect(api.pullMembers(session, null)).rejects.toBeInstanceOf(ApiError);
    await expect(api.pullMembers(session, null)).rejects.toMatchObject({ kind: 'NETWORK' });
  });
});

describe('helpers', () => {
  test('member status words from the server', () => {
    expect(mapMemberStatus('ACTIVE')).toBe('ACTIVE');
    expect(mapMemberStatus('active')).toBe('ACTIVE');
    expect(mapMemberStatus('PENDING')).toBe('PENDING_APPROVAL');
    for (const word of ['INACTIVE', 'DORMANT', '']) expect(mapMemberStatus(word)).toBe('INACTIVE');
  });
  test('twoDecimals never uses floating point', () => {
    expect(twoDecimals('0.1')).toBe('0.10');
    expect(twoDecimals('999999999999999.995')).toBe('999999999999999.99');
    expect(twoDecimals('abc')).toBeNull();
    expect(twoDecimals(null)).toBeNull();
  });
  test('messageFrom reads a message, a list of messages or a reason', () => {
    expect(messageFrom({ message: 'x' }, 'f')).toBe('x');
    expect(messageFrom({ message: ['a', 'b'] }, 'f')).toBe('a b');
    expect(messageFrom({ reason: 'why' }, 'f')).toBe('why');
    expect(messageFrom({}, 'f')).toBe('f');
    expect(messageFrom(null, 'f')).toBe('f');
  });
  test('mapMember tolerates a member with no account', () => {
    const m = mapMember({ code: '1', fullName: 'A B', status: 'ACTIVE' }, 'now', '100');
    expect(m.savingsAccountId).toBeNull();
    expect(m.balances.savings).toBe('0.00');
  });
});
