import bcrypt from 'bcryptjs';
import { createServer } from 'node:http';
import { beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../src/app';
import type { Config } from '../src/config';
import type { AccountInfo } from '../src/repo';
import { HttpSmsProvider, PendingSmsNotifier, pendingMessage, smsPhone, type SmsProvider, type SmsSendResult } from '../src/sms';
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
  smsPendingEnabled: true,
};

const base = { customerCode: '10', branchCode: '100', accountStatus: 'ACTIVE', customerActive: true, customerStatusCode: 'ACT' };
const savings = (over: Partial<AccountInfo> = {}): AccountInfo => ({
  ...base, kind: 'SAVINGS', accountId: 500, currentBalance: '100.00', productCode: 'MS', productName: 'Member Savings', productActive: true, ...over,
});
const shares = (over: Partial<AccountInfo> = {}): AccountInfo => ({
  ...base, kind: 'SHARES', accountId: 700, currentBalance: '40.00', productCode: 'OS', productName: 'Ordinary Shares', productActive: true, ...over,
});

class FakeProvider implements SmsProvider {
  sent: { phone: string; message: string }[] = [];
  result: SmsSendResult = { success: true, response: { status: 'success' } };
  throws = false;
  gate: Promise<void> | null = null;
  async send(_s: unknown, phone: string, message: string) {
    if (this.gate) await this.gate;
    if (this.throws) throw new Error('provider exploded');
    this.sent.push({ phone, message });
    return this.result;
  }
}

let repo: MemoryRepo;
let provider: FakeProvider;
let notifier: PendingSmsNotifier;
let app: ReturnType<typeof buildApp>;
let auth: string;

async function setup(opts: { smsEnabled?: boolean } = {}) {
  repo = new MemoryRepo();
  provider = new FakeProvider();
  repo.officers = [
    { id: '1006', staffId: 'mabel', fullName: 'Mabel', branchCode: '100', passwordHash: bcrypt.hashSync('1234', 4), active: true },
  ];
  repo.accounts = [
    savings(),
    savings({ accountId: 501, accountStatus: 'ACTIVE', isDormant: true }),
    savings({ accountId: 502, isClosed: true }),
    savings({ accountId: 503, productActive: false }),
    savings({ accountId: 504, minAmount: '10.00', maxAmount: '200.00' }),
    savings({ accountId: 505, minAmount: '0.00', maxAmount: '0.00' }),
    shares(),
    shares({ accountId: 701, isClosed: true }),
    shares({ accountId: 702, productActive: false }),
    shares({ accountId: 703, minAmount: '20.00', maxAmount: '100.00' }),
    shares({ accountId: 704, branchCode: '200' }),
    shares({ accountId: 705, accountStatus: 'CLOSED' }),
    shares({ accountId: 706, customerCode: '11' }),
  ];
  repo.recipients.set('10', { phone: '0244123456', optedOut: false, firstName: 'Ama', fullName: 'Ama Mensah' });
  repo.smsSettings = { ...repo.smsSettings, enabled: opts.smsEnabled ?? true };
  notifier = new PendingSmsNotifier({ repo, provider, enabled: true, now: () => NOW, log: () => {} });
  app = buildApp({ config, repo, now: () => NOW, notifier });
  const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'mabel', pin: '1234', deviceId: 'device-0001' } });
  auth = `Bearer ${res.json().accessToken}`;
}

const body = (over: Record<string, unknown> = {}) => ({
  localTransactionId: 'txn-00000001',
  memberCode: '10',
  accountId: 500,
  amount: '25.00',
  collectedAt: '2026-11-25T11:00:00.000Z',
  ...over,
});
const post = (payload: unknown) => app.inject({ method: 'POST', url: '/v1/deposits', headers: { authorization: auth }, payload: payload as object });

describe('deposit kinds', () => {
  beforeEach(() => setup());

  test('kind defaults to SAVINGS and is stored with the core idempotency prefix', async () => {
    const res = await post(body());
    expect(res.statusCode).toBe(201);
    expect(res.json().serverId).toBe('1000');
    expect(repo.rows[0]).toMatchObject({ kind: 'SAVINGS', reference: 'MOBIDEMP-txn-00000001' });
  });

  test('a share purchase goes to the holding, with a serverId that cannot clash with a savings id', async () => {
    const res = await post(body({ kind: 'SHARES', accountId: 700, amount: '30.00' }));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: 'ACCEPTED', serverId: 'SH1000' });
    expect(repo.rows[0]).toMatchObject({ kind: 'SHARES', accountId: 700, productCode: 'OS', status: 'PENDING' });
  });

  test('the savings account id is not a share holding id', async () => {
    const res = await post(body({ kind: 'SHARES', accountId: 500 }));
    expect(res.statusCode).toBe(422);
    expect(res.json().reason).toMatch(/share account does not belong/);
  });

  test('repeating a share deposit is a duplicate; a different amount is a conflict', async () => {
    await post(body({ kind: 'SHARES', accountId: 700 }));
    const again = await post(body({ kind: 'SHARES', accountId: 700 }));
    expect(again.statusCode).toBe(200);
    expect(again.json().status).toBe('DUPLICATE');
    const clash = await post(body({ kind: 'SHARES', accountId: 700, amount: '26.00' }));
    expect(clash.statusCode).toBe(409);
    expect(repo.rows).toHaveLength(1);
  });

  test('the same id under the other kind is a conflict and stores nothing', async () => {
    await post(body());
    const res = await post(body({ kind: 'SHARES', accountId: 700 }));
    expect(res.statusCode).toBe(409);
    expect(res.json().status).toBe('CONFLICT');
    expect(repo.rows).toHaveLength(1);
  });

  test('an unknown kind is malformed', async () => {
    expect((await post(body({ kind: 'LOANS' }))).statusCode).toBe(400);
  });

  test('mobile money is refused and nothing is stored; CASH is fine', async () => {
    for (const mode of ['MOMO', 'MOBILE_MONEY', 'momo']) {
      const res = await post(body({ paymentMode: mode }));
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ status: 'REJECTED', reason: 'Mobile money deposits are not available yet.' });
    }
    expect(repo.rows).toHaveLength(0);
    expect((await post(body({ paymentMode: 'CASH' }))).statusCode).toBe(201);
  });

  test('ids longer than 41 characters do not fit the reference column', async () => {
    expect((await post(body({ localTransactionId: 'a'.repeat(42) }))).statusCode).toBe(400);
    expect((await post(body({ localTransactionId: 'a'.repeat(41) }))).statusCode).toBe(201);
    expect((await post(body({ localTransactionId: '3f2b9c1e-8a4d-4e6f-9b0a-1c2d3e4f5a6b', amount: '1.00' }))).statusCode).toBe(201);
  });
});

describe('eligibility', () => {
  beforeEach(() => setup());

  test.each([
    ['a dormant savings account', { accountId: 501 }, /dormant/],
    ['a closed savings account', { accountId: 502 }, /closed/],
    ['a savings product that is switched off', { accountId: 503 }, /no longer offered/],
    ['an amount under the savings minimum', { accountId: 504, amount: '9.99' }, /minimum deposit .* GHS 10.00/],
    ['an amount over the savings maximum', { accountId: 504, amount: '200.01' }, /maximum deposit .* GHS 200.00/],
    ['a closed share holding', { kind: 'SHARES', accountId: 701 }, /closed/],
    ['a share product that is switched off', { kind: 'SHARES', accountId: 702 }, /no longer offered/],
    ['an amount under the share minimum', { kind: 'SHARES', accountId: 703, amount: '19.99' }, /minimum purchase .* GHS 20.00/],
    ['an amount over the share maximum', { kind: 'SHARES', accountId: 703, amount: '100.01' }, /maximum purchase .* GHS 100.00/],
    ['a share holding in another branch', { kind: 'SHARES', accountId: 704 }, /not in your branch/],
    ['an inactive share holding', { kind: 'SHARES', accountId: 705 }, /not active/],
    ["another member's share holding", { kind: 'SHARES', accountId: 706 }, /does not belong/],
  ])('rejects %s and stores nothing', async (_n, over, reason) => {
    const res = await post(body(over));
    expect(res.statusCode).toBe(422);
    expect(res.json().reason).toMatch(reason);
    expect(repo.rows).toHaveLength(0);
  });

  test('limits of 0 mean no limit, and amounts on the limit are fine', async () => {
    expect((await post(body({ accountId: 505, amount: '1.00' }))).statusCode).toBe(201);
    expect((await post(body({ accountId: 504, amount: '10.00', localTransactionId: 'txn-00000002' }))).statusCode).toBe(201);
    expect((await post(body({ accountId: 504, amount: '200.00', localTransactionId: 'txn-00000003' }))).statusCode).toBe(201);
    expect((await post(body({ kind: 'SHARES', accountId: 703, amount: '100.00', localTransactionId: 'txn-00000004' }))).statusCode).toBe(201);
  });
});

describe('the banker deposit list', () => {
  beforeEach(() => setup());

  test('lists savings and share rows with their kind and the original ids', async () => {
    await post(body());
    await post(body({ localTransactionId: 'txn-00000002', kind: 'SHARES', accountId: 700, amount: '9.00' }));
    const res = (await app.inject({ method: 'GET', url: '/v1/deposits', headers: { authorization: auth } })).json();
    expect(res.items.map((i: { kind: string; localTransactionId: string }) => [i.kind, i.localTransactionId])).toEqual([
      ['SAVINGS', 'txn-00000001'],
      ['SHARES', 'txn-00000002'],
    ]);
    expect(res.items[1]).toMatchObject({ serverId: 'SH1001', status: 'PENDING', amount: '9.00' });
  });

  test('a row written earlier under the bare id is still found as a duplicate and listed', async () => {
    repo.rows.push({
      kind: 'SAVINGS', id: 7, reference: 'txn-00000001', customerCode: '10', amount: '25.00', status: 'PENDING',
      createdAt: NOW, decidedAt: null, reason: null, officerId: '1006', accountId: 500, branch: '100', productCode: 'MS',
    });
    const res = await post(body());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'DUPLICATE', serverId: '7' });
    const list = (await app.inject({ method: 'GET', url: '/v1/deposits', headers: { authorization: auth } })).json();
    expect(list.items[0].localTransactionId).toBe('txn-00000001');
  });
});

describe('members', () => {
  test('carry the accounts a deposit can go into, alongside the old fields', async () => {
    await setup();
    repo.members = [
      {
        code: '10', fullName: 'Ama', phone: null, statusCode: 'ACT', isActive: true, savingsAccountId: 500, savingsBalance: '100.00',
        accounts: {
          savings: [{ id: 500, number: '0001', productCode: 'MS', productName: 'Member Savings', balance: '100.00' }],
          shares: [{ id: 700, number: 'S-1', productCode: 'OS', productName: 'Ordinary Shares', balance: '40.00' }],
        },
      },
    ];
    const res = (await app.inject({ method: 'GET', url: '/v1/members', headers: { authorization: auth } })).json();
    expect(res.items[0]).toMatchObject({ code: '10', savingsAccountId: 500, savingsBalance: '100.00' });
    expect(res.items[0].accounts.savings[0]).toEqual({ id: 500, number: '0001', productCode: 'MS', productName: 'Member Savings', balance: '100.00' });
    expect(res.items[0].accounts.shares[0].id).toBe(700);
  });
});

describe('pending-deposit text message', () => {
  beforeEach(() => setup());

  test('is sent once the row is stored, with the message and a log entry', async () => {
    const res = await post(body({ localTransactionId: '3f2b9c1e-8a4d-4e6f-9b0a-1c2d3e4f5a6b' }));
    expect(res.statusCode).toBe(201);
    await notifier.idle();
    expect(provider.sent).toEqual([
      { phone: '0244123456', message: 'Dear Ama, GHS 25.00 received for your Member Savings account, pending approval. Ref: 3F2B9C1E' },
    ]);
    expect(repo.smsLog).toHaveLength(1);
    expect(repo.smsLog[0]).toMatchObject({
      messageType: 'DEPOSIT_PENDING', status: 'SENT', customerCode: '10', branchCode: '100', userId: '1006',
      referenceNo: 'MOBIDEMP-3f2b9c1e-8a4d-4e6f-9b0a-1c2d3e4f5a6b',
    });
  });

  test('a share deposit names the share product', async () => {
    await post(body({ kind: 'SHARES', accountId: 700 }));
    await notifier.idle();
    expect(provider.sent[0].message).toContain('for your Ordinary Shares account');
  });

  test('is not sent for a duplicate, a conflict or a rejection', async () => {
    await post(body());
    await notifier.idle();
    provider.sent.length = 0;
    repo.smsLog.length = 0;
    await post(body());
    await post(body({ amount: '26.00' }));
    await post(body({ localTransactionId: 'txn-00000002', accountId: 501 }));
    await post(body({ localTransactionId: 'txn-00000003', paymentMode: 'MOMO' }));
    await notifier.idle();
    expect(provider.sent).toHaveLength(0);
    expect(repo.smsLog).toHaveLength(0);
  });

  test('a provider that fails or throws never fails the deposit, and the failure is logged', async () => {
    provider.result = { success: false, error: 'Insufficient balance', response: { status: 'error' } };
    expect((await post(body())).statusCode).toBe(201);
    await notifier.idle();
    expect(repo.smsLog[0]).toMatchObject({ status: 'FAILED', error: 'Insufficient balance' });

    provider.throws = true;
    const res = await post(body({ localTransactionId: 'txn-00000002' }));
    expect(res.statusCode).toBe(201);
    await notifier.idle();
    expect(repo.rows).toHaveLength(2);
  });

  test('the response does not wait for the provider', async () => {
    let release!: () => void;
    provider.gate = new Promise<void>((r) => (release = r));
    const res = await post(body());
    expect(res.statusCode).toBe(201);
    expect(provider.sent).toHaveLength(0);
    release();
    await notifier.idle();
    expect(provider.sent).toHaveLength(1);
  });

  test('a message already logged for the reference is never sent twice', async () => {
    await post(body());
    await notifier.idle();
    const stored = { localTransactionId: 'txn-00000001', storedReference: 'MOBIDEMP-txn-00000001', customerCode: '10', branchCode: '100', officerId: '1006', amount: '25.00', productName: 'Member Savings' };
    expect(await notifier.notify(stored)).toBe(false);
    expect(provider.sent).toHaveLength(1);
  });

  test.each([
    ['the core has SMS switched off', () => { repo.smsSettings.enabled = false; }],
    ['the core has no key', () => { repo.smsSettings.apiKey = ''; }],
    ['the member has no mobile number', () => { repo.recipients.set('10', { phone: null, optedOut: false, firstName: 'Ama', fullName: 'Ama' }); }],
    ['the member opted out', () => { repo.recipients.set('10', { phone: '0244123456', optedOut: true, firstName: 'Ama', fullName: 'Ama' }); }],
  ])('nothing is sent when %s, and the deposit still succeeds', async (_n, arrange) => {
    arrange();
    expect((await post(body())).statusCode).toBe(201);
    await notifier.idle();
    expect(provider.sent).toHaveLength(0);
    expect(repo.smsLog).toHaveLength(0);
  });

  test('the server switch off means no text even when the core allows it', async () => {
    const off = new PendingSmsNotifier({ repo, provider, enabled: false, log: () => {} });
    const quiet = buildApp({ config: { ...config, smsPendingEnabled: false }, repo, now: () => NOW, notifier: off });
    const login = await quiet.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'mabel', pin: '1234', deviceId: 'device-0001' } });
    const res = await quiet.inject({ method: 'POST', url: '/v1/deposits', headers: { authorization: `Bearer ${login.json().accessToken}` }, payload: body() });
    expect(res.statusCode).toBe(201);
    await off.idle();
    expect(provider.sent).toHaveLength(0);
  });

  test('phone numbers are normalised like the core does', () => {
    expect(smsPhone('233244123456')).toBe('0244123456');
    expect(smsPhone('+233 24 412 3456')).toBe('0244123456');
    expect(smsPhone('244123456')).toBe('0244123456');
    expect(smsPhone('0312345678')).toBeNull();
    expect(smsPhone('9999')).toBeNull();
    expect(smsPhone('0311111111 / 0551234567')).toBe('0551234567');
    expect(pendingMessage('', '5.00', '', 'abcd-1234-zzzz')).toBe('Dear member, GHS 5.00 received for your account account, pending approval. Ref: ABCD1234');
  });
});

describe('the HTTP provider', () => {
  test('sends the Arkesel request shape to the configured URL and reads the answer', async () => {
    const seen: { headers: Record<string, unknown>; body: any }[] = [];
    let reply: unknown = { status: 'success', data: [{ id: 'm1' }] };
    const server = createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        seen.push({ headers: req.headers, body: JSON.parse(data) });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(reply));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const settings = { enabled: true, provider: 'arkesel', apiKey: 'secret-key', apiSecret: '', senderId: 'QSS', apiUrl: `http://127.0.0.1:${port}/send` };
    const provider = new HttpSmsProvider(2000);

    const ok = await provider.send(settings, '0244123456', 'hello');
    expect(ok.success).toBe(true);
    expect(seen[0].headers['api-key']).toBe('secret-key');
    expect(seen[0].body).toEqual({ sender: 'QSS', message: 'hello', recipients: ['0244123456'], sandbox: false });

    reply = { status: 'error', message: 'Invalid key' };
    const bad = await provider.send(settings, '0244123456', 'hello');
    expect(bad).toMatchObject({ success: false, error: 'Invalid key' });

    const none = await provider.send({ ...settings, apiKey: '' }, '0244123456', 'hello');
    expect(none.success).toBe(false);
    server.close();

    const down = await provider.send(settings, '0244123456', 'hello');
    expect(down.success).toBe(false);
  });
});
