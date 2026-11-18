import { ApiError } from './contract';
import { HttpApi, mapMember, mapMemberStatus, messageFrom, twoDecimals } from './http';
import type { Session } from '@/domain/types';

/**
 * A fake core banking server. Each route is a function from the request to a
 * status and body, and every request is recorded so tests can check exactly
 * what the app sent.
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
    const path = url.replace('https://core.test', '');
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

const OFFICER_ID = '11111111-1111-4111-8111-111111111111';
const DEVICE = 'device-abcdef-1';

const officerList: Route = () => ({
  status: 200,
  body: { items: [{ officerId: OFFICER_ID, staffId: 'FO001', displayName: 'Field Officer One', branchCode: '001', status: 'ACTIVE', cashLimit: '20000.00' }] },
});
const deviceList = (device: Record<string, unknown> | null): Route => () => ({
  status: 200,
  body: { items: device ? [device] : [] },
});
const okDevice = { deviceId: DEVICE, status: 'ACTIVE', trusted: true };
const loginOk: Route = () => ({ status: 200, body: { accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 900 } });

const session: Session = {
  officerId: OFFICER_ID,
  officerName: 'Field Officer One',
  branchCode: '001',
  deviceId: DEVICE,
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  limits: { maxUnsyncedItems: 200, maxUnsyncedAmount: '20000.00', maxSingleAmount: '5000.00' },
};

const deposit = {
  localTransactionId: 'local-1',
  memberCode: '100001',
  productType: 'SAVINGS_DEPOSIT' as const,
  amount: '40.00',
  reference: null,
  collectedAt: '2026-11-18T08:00:00.000Z',
  accountId: 500001,
};

const make = (routes: Record<string, Route>) => {
  const server = fakeServer(routes);
  const tokens: Array<{ accessToken: string; refreshToken: string }> = [];
  const api = new HttpApi({ baseUrl: 'https://core.test/', fetchImpl: server.fetchImpl, onTokens: (t) => tokens.push(t) });
  return { api, calls: server.calls, tokens };
};

describe('sign-in', () => {
  test('signs in with the staff account, finds the banker record, and checks the phone', async () => {
    const { api, calls } = make({
      'POST /auth/login': loginOk,
      'GET /mobile-banking/bankers': officerList,
      'GET /mobile-banking/devices': deviceList(okDevice),
    });
    const result = await api.login(' fo001 ', 'Secret123', DEVICE);
    expect(result.kind).toBe('SIGNED_IN');
    if (result.kind !== 'SIGNED_IN') return;
    expect(result.session).toMatchObject({ officerId: OFFICER_ID, officerName: 'Field Officer One', branchCode: '001', deviceId: DEVICE });
    // The officer's cash limit becomes the ceiling on unsynced cash.
    expect(result.session.limits.maxUnsyncedAmount).toBe('20000.00');
    expect(calls[0].body).toEqual({ username: 'fo001', password: 'Secret123' });
    expect(calls[1].headers.authorization).toBe('Bearer access-1');
  });

  test('a wrong password says so plainly', async () => {
    const { api } = make({ 'POST /auth/login': () => ({ status: 401, body: { message: 'Invalid credentials' } }) });
    await expect(api.login('FO001', 'wrong-pass', DEVICE)).rejects.toMatchObject({ kind: 'AUTH', message: 'Staff ID or password is incorrect.' });
  });

  test('a staff user who is not a mobile banker is told to ask the supervisor', async () => {
    const { api } = make({
      'POST /auth/login': loginOk,
      'GET /mobile-banking/bankers': () => ({ status: 200, body: { items: [] } }),
    });
    await expect(api.login('FO001', 'Secret123', DEVICE)).rejects.toThrow(/not set up as a mobile banker/);
  });

  test('an unregistered phone is told its id so the supervisor can register it', async () => {
    const { api } = make({
      'POST /auth/login': loginOk,
      'GET /mobile-banking/bankers': officerList,
      'GET /mobile-banking/devices': deviceList(null),
    });
    await expect(api.login('FO001', 'Secret123', DEVICE)).rejects.toThrow(new RegExp(`supervisor: ${DEVICE}`));
  });

  test('a registered phone that is not trusted yet cannot sign in', async () => {
    const { api } = make({
      'POST /auth/login': loginOk,
      'GET /mobile-banking/bankers': officerList,
      'GET /mobile-banking/devices': deviceList({ ...okDevice, trusted: false }),
    });
    await expect(api.login('FO001', 'Secret123', DEVICE)).rejects.toThrow(/not yet approved as trusted/);
  });

  test('the exact staff id must match, not just a search hit', async () => {
    const { api } = make({
      'POST /auth/login': loginOk,
      'GET /mobile-banking/bankers': () => ({ status: 200, body: { items: [{ officerId: 'x', staffId: 'FO0011', status: 'ACTIVE' }] } }),
    });
    await expect(api.login('FO001', 'Secret123', DEVICE)).rejects.toThrow(/not set up as a mobile banker/);
  });

  test('this server has no SMS code step', () => {
    expect(make({}).api.capabilities.otp).toBe(false);
  });
});

describe('reading members and accounts', () => {
  test('maps the core member list and its cursor', async () => {
    const { api, calls } = make({
      'GET /customers': () => ({
        status: 200,
        body: {
          items: [
            { code: '1001', fullName: 'Ama Mensah', phone: '0241234567', status: 'ACT', branchCode: '001' },
            { code: '1002', fullName: '  Kofi Owusu ', phone: null, status: 'PND', branchCode: '001' },
            { code: '1003', firstName: 'Esi', lastName: 'Addo', status: 'SUS', branchCode: '001' },
          ],
          nextCursor: '1003',
        },
      }),
    });
    const page = await api.pullMembers(session, '1000');
    expect(calls[0].path).toBe('/customers?limit=100&cursor=1000');
    expect(page.nextCursor).toBe('1003');
    expect(page.items.map((m) => [m.memberCode, m.name, m.status, m.phone])).toEqual([
      ['1001', 'Ama Mensah', 'ACTIVE', '0241234567'],
      ['1002', 'Kofi Owusu', 'PENDING_APPROVAL', ''],
      ['1003', 'Esi Addo', 'INACTIVE', ''],
    ]);
    // The core does not give shares or loan balances to the field channel yet.
    expect(page.items[0].balances).toEqual({ savings: '0.00', shares: null, loan: null });
  });

  test('the last page has no cursor', async () => {
    const { api } = make({ 'GET /customers': () => ({ status: 200, body: { items: [] } }) });
    expect((await api.pullMembers(session, null)).nextCursor).toBeNull();
  });

  test('savings accounts give the account id and an exact two-decimal balance', async () => {
    const { api, calls } = make({
      'GET /savings/accounts': () => ({
        status: 200,
        body: {
          items: [
            { id: 500001, customerCode: '1001', currentBalance: '1234.5000', accountNumber: 'S1' },
            { id: 500002, customerCode: '1002', currentBalance: '-20.10', accountNumber: 'S2' },
            { id: 'bad', customerCode: '1003', currentBalance: '5' },
          ],
          nextCursor: 'S2',
        },
      }),
    });
    const page = await api.pullSavingsAccounts(session, null);
    expect(calls[0].path).toBe('/savings/accounts?limit=100&status=ACTIVE');
    expect(page.items).toEqual([
      { memberCode: '1001', accountId: 500001, balance: '1234.50' },
      { memberCode: '1002', accountId: 500002, balance: '-20.10' },
    ]);
    expect(page.nextCursor).toBe('S2');
  });
});

describe('sending deposits', () => {
  const accepted: Route = () => ({ status: 201, body: { transactionId: 'T-1', state: 'RECEIVED' } });

  test('sends the request the core expects, with an idempotency key', async () => {
    const { api, calls } = make({ 'POST /mobile-banking/transactions': accepted });
    const [result] = await api.pushTransactions(session, [deposit]);
    expect(result).toEqual({ localTransactionId: 'local-1', status: 'ACCEPTED', serverId: 'T-1' });
    expect(calls[0].headers['idempotency-key']).toBe(`${DEVICE}:local-1`);
    expect(calls[0].body).toMatchObject({
      officerId: OFFICER_ID,
      deviceId: DEVICE,
      localTransactionId: 'local-1',
      memberCode: '100001',
      accountId: 500001,
      transactionType: 'DEPOSIT',
      amount: '40.00',
      currency: 'GHS',
    });
  });

  test('only deposits are sent; other collections are held back by the app, and refused here as a safeguard', async () => {
    const { api, calls } = make({});
    const [share, noAccount] = await api.pushTransactions(session, [
      { ...deposit, localTransactionId: 'a', productType: 'SHARE_CONTRIBUTION' },
      { ...deposit, localTransactionId: 'b', accountId: null },
    ]);
    expect(share.status).toBe('REJECTED');
    expect(noAccount.status).toBe('REJECTED');
    expect(calls).toHaveLength(0);
  });

  test('a business refusal is shown with the core system\'s own words', async () => {
    const { api } = make({
      'POST /mobile-banking/transactions': () => ({ status: 400, body: { message: 'The savings account must be active and belong to the selected member in your branch' } }),
    });
    const [result] = await api.pushTransactions(session, [deposit]);
    expect(result).toMatchObject({ status: 'REJECTED', reason: expect.stringMatching(/savings account must be active/) });
  });

  test('a validation list is joined into one readable message', async () => {
    const { api } = make({
      'POST /mobile-banking/transactions': () => ({ status: 400, body: { message: ['amount must match a regular expression', 'collectedAt must be a valid ISO 8601 date string'] } }),
    });
    const [result] = await api.pushTransactions(session, [deposit]);
    expect(result.reason).toMatch(/amount must match.*collectedAt must be/);
  });

  test('the same id with different details is a conflict, not an overwrite', async () => {
    const { api } = make({
      'POST /mobile-banking/transactions': () => ({ status: 409, body: { message: 'The device local transaction id is already associated with a different request' } }),
    });
    const [result] = await api.pushTransactions(session, [deposit]);
    expect(result.status).toBe('CONFLICT');
  });

  test('losing the connection part-way returns what was answered and leaves the rest waiting', async () => {
    let n = 0;
    const { api } = make({
      'POST /mobile-banking/transactions': () => {
        n += 1;
        if (n === 2) throw new TypeError('Network request failed');
        return { status: 201, body: { transactionId: `T-${n}` } };
      },
    });
    const results = await api.pushTransactions(session, [deposit, { ...deposit, localTransactionId: 'local-2' }, { ...deposit, localTransactionId: 'local-3' }]);
    expect(results.map((r) => r.localTransactionId)).toEqual(['local-1']);
  });

  test('losing the connection on the first item is a network error', async () => {
    const { api } = make({
      'POST /mobile-banking/transactions': () => {
        throw new TypeError('Network request failed');
      },
    });
    await expect(api.pushTransactions(session, [deposit])).rejects.toMatchObject({ kind: 'NETWORK' });
  });

  test('server trouble is a server error so the item stays waiting and is retried', async () => {
    const { api } = make({ 'POST /mobile-banking/transactions': () => ({ status: 503, body: { message: 'boom' } }) });
    await expect(api.pushTransactions(session, [deposit])).rejects.toMatchObject({ kind: 'SERVER' });
  });

  test('a role the core refuses is shown, not treated as a sign-out', async () => {
    const { api } = make({
      'POST /mobile-banking/transactions': () => ({ status: 403, body: { message: 'Submitting a field transaction requires a field-operations role' } }),
    });
    await expect(api.pushTransactions(session, [deposit])).rejects.toMatchObject({ kind: 'SERVER', message: expect.stringMatching(/field-operations/) });
  });
});

describe('session renewal', () => {
  test('an expired session is renewed once and the request repeated', async () => {
    let first = true;
    const { api, calls, tokens } = make({
      'POST /mobile-banking/transactions': (req) => {
        if (first) {
          first = false;
          return { status: 401, body: { message: 'Unauthorized' } };
        }
        expect(req.headers.authorization).toBe('Bearer access-2');
        return { status: 201, body: { transactionId: 'T-9' } };
      },
      'POST /auth/refresh': () => ({ status: 200, body: { accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 900 } }),
    });
    const [result] = await api.pushTransactions(session, [deposit]);
    expect(result.status).toBe('ACCEPTED');
    expect(calls.map((c) => c.path)).toEqual(['/mobile-banking/transactions', '/auth/refresh', '/mobile-banking/transactions']);
    expect(calls[1].body).toEqual({ refreshToken: 'refresh-1' });
    // The new tokens are handed back so the app can store them.
    expect(tokens).toEqual([{ accessToken: 'access-2', refreshToken: 'refresh-2' }]);
  });

  test('two calls that expire together share one renewal', async () => {
    let refreshes = 0;
    let stale = 2;
    const { api } = make({
      'GET /customers': () => {
        if (stale > 0) {
          stale -= 1;
          return { status: 401 };
        }
        return { status: 200, body: { items: [] } };
      },
      'POST /auth/refresh': async () => {
        refreshes += 1;
        return { status: 200, body: { accessToken: 'access-2', refreshToken: 'refresh-2' } };
      },
    });
    await Promise.all([api.pullMembers(session, null), api.pullMembers(session, null)]);
    expect(refreshes).toBe(1);
  });

  test('when the refresh token is also refused, the user must sign in again', async () => {
    const { api } = make({
      'GET /customers': () => ({ status: 401 }),
      'POST /auth/refresh': () => ({ status: 401, body: { message: 'Invalid refresh token' } }),
    });
    await expect(api.pullMembers(session, null)).rejects.toMatchObject({ kind: 'AUTH' });
  });

  test('being offline while renewing is a network problem, not a sign-out', async () => {
    let calls = 0;
    const { api } = make({
      'GET /customers': () => ({ status: 401 }),
      'POST /auth/refresh': () => {
        calls += 1;
        throw new TypeError('Network request failed');
      },
    });
    await expect(api.pullMembers(session, null)).rejects.toBeInstanceOf(ApiError);
    await expect(api.pullMembers(session, null)).rejects.toMatchObject({ kind: 'NETWORK' });
    expect(calls).toBeGreaterThan(0);
  });
});

describe('helpers', () => {
  test('member status codes', () => {
    expect(mapMemberStatus('ACT')).toBe('ACTIVE');
    expect(mapMemberStatus('active')).toBe('ACTIVE');
    expect(mapMemberStatus('PND')).toBe('PENDING_APPROVAL');
    for (const code of ['INA', 'DOR', 'SUS', 'CLO', '']) expect(mapMemberStatus(code)).toBe('INACTIVE');
  });
  test('twoDecimals never uses floating point', () => {
    expect(twoDecimals('0.1')).toBe('0.10');
    expect(twoDecimals('999999999999999.995')).toBe('999999999999999.99');
    expect(twoDecimals('abc')).toBeNull();
    expect(twoDecimals(null)).toBeNull();
  });
  test('messageFrom', () => {
    expect(messageFrom({ message: 'x' }, 'f')).toBe('x');
    expect(messageFrom({}, 'f')).toBe('f');
    expect(messageFrom(null, 'f')).toBe('f');
  });
  test('mapMember falls back to first and last name', () => {
    expect(mapMember({ code: '1', firstName: 'A', lastName: 'B', status: 'ACT' }, 'now').name).toBe('A B');
  });
});
