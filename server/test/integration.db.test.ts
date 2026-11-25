/**
 * Checks against a real (dummy) core database. Skipped unless HERMES_INTEGRATION=1, and it
 * writes rows into whatever DB_* points at, so never aim it at a live database.
 *
 *   HERMES_INTEGRATION=1 DB_SERVER=127.0.0.1 DB_PORT=1433 DB_NAME=bankpro_test DB_USER=sa \
 *   DB_PASSWORD=... INT_BANKER=banker INT_PIN=... npx vitest run test/integration.db.test.ts
 *
 * It removes the rows it created (references starting "itest") and restores the SMS settings.
 */
import { createServer } from 'node:http';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp } from '../src/app';
import type { Config } from '../src/config';
import { MssqlRepo } from '../src/mssql-repo';
import { HttpSmsProvider, PendingSmsNotifier } from '../src/sms';

const run = process.env.HERMES_INTEGRATION === '1';
const d = run ? describe : describe.skip;

const env = process.env;
const dbConfig = {
  server: env.DB_SERVER ?? '127.0.0.1',
  port: Number(env.DB_PORT ?? 1433),
  database: env.DB_NAME ?? 'bankpro_test',
  user: env.DB_USER ?? 'sa',
  password: env.DB_PASSWORD ?? '',
  encrypt: false,
  trustServerCertificate: true,
};
const config: Config = {
  port: 0,
  host: '127.0.0.1',
  jwtSecret: 'integration-secret-integration-secret-1234',
  accessTtlSeconds: 1800,
  refreshTtlSeconds: 43200,
  db: dbConfig,
  limits: { maxSingleAmount: '5000.00', maxUnsyncedAmount: '50000.00', maxUnsyncedItems: 200 },
  maxBackdateDays: 7,
  pinMaxAttempts: 50,
  pinLockoutMinutes: 1,
  smsPendingEnabled: true,
};

const RUN = `itest${Date.now().toString(36)}`;
const ids = (n: string) => `${RUN}-${n}`.slice(0, 41);
const collectedAt = () => new Date(Date.now() - 3600_000).toISOString();

d('against the dummy core database', () => {
  let repo: MssqlRepo;
  let pool: sql.ConnectionPool;
  let app: ReturnType<typeof buildApp>;
  let notifier: PendingSmsNotifier;
  let auth: string;
  const savedSettings = new Map<string, string | null>();
  const hits: { headers: Record<string, unknown>; body: any }[] = [];
  let fake: ReturnType<typeof createServer>;

  const post = (payload: object) => app.inject({ method: 'POST', url: '/v1/deposits', headers: { authorization: auth }, payload });
  const q = async (text: string, inputs: Record<string, unknown> = {}) => {
    const r = pool.request();
    for (const [k, v] of Object.entries(inputs)) r.input(k, v as string);
    return (await r.query(text)).recordset;
  };

  beforeAll(async () => {
    repo = await MssqlRepo.connect(dbConfig);
    // Open a full pool first. Cold connections take hundreds of milliseconds each, which would
    // otherwise serialise the "simultaneous" requests and hide a race.
    await Promise.all(Array.from({ length: 10 }, () => repo.listMembers('100', 0, 500)));
    pool = await new sql.ConnectionPool({ server: dbConfig.server, port: dbConfig.port, database: dbConfig.database, user: env.INT_ADMIN_USER ?? dbConfig.user, password: env.INT_ADMIN_PASSWORD ?? dbConfig.password, options: { encrypt: false, trustServerCertificate: true } }).connect();

    fake = createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        hits.push({ headers: req.headers, body: JSON.parse(data) });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ status: 'success', data: [{ id: 'fake-1' }] }));
      });
    });
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
    const port = (fake.address() as { port: number }).port;

    // Point the core's own SMS settings at the fake provider (TEST database only); restored in afterAll.
    const wanted: Record<string, string> = { SMS_Enabled: 'true', SMS_Provider: 'arkesel', SMS_ApiKey: 'itest-key', SMS_SenderId: 'QSS', SMS_API_URL: `http://127.0.0.1:${port}/send` };
    for (const [k, v] of Object.entries(wanted)) {
      const row = await q(`SELECT [Value] FROM AppSettings WHERE [Key] = @k`, { k });
      savedSettings.set(k, row.length ? row[0].Value : null);
      if (row.length) await q(`UPDATE AppSettings SET [Value] = @v WHERE [Key] = @k`, { k, v });
      else await q(`INSERT AppSettings ([Key], [Value]) VALUES (@k, @v)`, { k, v });
    }

    notifier = new PendingSmsNotifier({ repo, provider: new HttpSmsProvider(5000), enabled: true, log: () => {} });
    app = buildApp({ config, repo, notifier });
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: env.INT_BANKER ?? 'banker', pin: env.INT_PIN ?? '', deviceId: 'itest-device' } });
    expect(login.statusCode).toBe(200);
    auth = `Bearer ${login.json().accessToken}`;
  }, 60_000);

  afterAll(async () => {
    await notifier?.idle();
    if (pool) {
      await q(`DELETE FROM SMSHistory WHERE ReferenceNo LIKE 'MOBIDEMP-itest%'`);
      await q(`DELETE FROM SavingsTransaction WHERE ReferenceNumber LIKE 'MOBIDEMP-itest%' OR ReferenceNumber LIKE 'itest%'`);
      await q(`DELETE FROM ShareTransaction WHERE ReferenceNumber LIKE 'MOBIDEMP-itest%' OR ReferenceNumber LIKE 'itest%'`);
      for (const [k, v] of savedSettings) {
        if (v === null) await q(`DELETE FROM AppSettings WHERE [Key] = @k`, { k });
        else await q(`UPDATE AppSettings SET [Value] = @v WHERE [Key] = @k`, { k, v });
      }
      await pool.close();
    }
    fake?.close();
    await repo?.close();
  }, 60_000);

  test('members: accounts for a multi-account member, and a full pull is fast', async () => {
    const first = await app.inject({ method: 'GET', url: '/v1/members?limit=500', headers: { authorization: auth } });
    expect(first.statusCode).toBe(200);
    const m = first.json().items.find((i: { code: string }) => i.code === '181');
    expect(m.accounts.savings.length).toBe(2);
    expect(m.accounts.shares.length).toBeGreaterThanOrEqual(1);
    expect(m.savingsAccountId).toBe(m.accounts.savings[0].id);
    console.log('MEMBER SHAPE', JSON.stringify({ ...m, fullName: 'REDACTED', phone: null }));

    const t0 = Date.now();
    let cursor: string | null = null;
    let total = 0;
    let pages = 0;
    do {
      const res = await app.inject({ method: 'GET', url: `/v1/members?limit=500${cursor ? `&cursor=${cursor}` : ''}`, headers: { authorization: auth } });
      const body = res.json();
      total += body.items.length;
      pages += 1;
      cursor = body.nextCursor;
    } while (cursor);
    const ms = Date.now() - t0;
    console.log(`FULL PULL members=${total} pages=${pages} ms=${ms}`);
    expect(ms).toBeLessThan(10_000);
  }, 60_000);

  test('a savings deposit is stored pending with the prefixed reference, once', async () => {
    const payload = { localTransactionId: ids('sav1'), memberCode: '209', accountId: 182495, amount: '12.34', collectedAt: collectedAt() };
    const a = await post(payload);
    expect(a.statusCode).toBe(201);
    const b = await post(payload);
    expect(b.statusCode).toBe(200);
    expect(b.json().serverId).toBe(a.json().serverId);
    const rows = await q(`SELECT ReferenceNumber, Status, BankingType, TransactionType, Credit, RTRIM(UserID) AS UserID, BranchCode FROM SavingsTransaction WHERE ReferenceNumber LIKE @r`, { r: `%${ids('sav1')}` });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ReferenceNumber: `MOBIDEMP-${ids('sav1')}`, Status: 'PENDING', BankingType: 'MOBILE-BANKING', TransactionType: 'DEPOSIT', UserID: '1026', BranchCode: '100' });
    await notifier.idle();
  });

  test('a share purchase is stored exactly as the core approval reads it', async () => {
    const res = await post({ localTransactionId: ids('shr1'), kind: 'SHARES', memberCode: '181', accountId: 24716, amount: '7.50', collectedAt: collectedAt() });
    expect(res.statusCode).toBe(201);
    expect(res.json().serverId).toMatch(/^SH\d+$/);
    const rows = await q(`SELECT * FROM ShareTransaction WHERE ReferenceNumber = @r`, { r: `MOBIDEMP-${ids('shr1')}` });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ShareHoldingID: 24716, ShareCode: 'OS', TransactionType: 'PURCHASE', Status: 'PENDING', BankingType: 'MOBILE-BANKING', BranchCode: '100' });
    expect(Number(rows[0].Credit)).toBe(7.5);
    expect(Number(rows[0].TransactionAmount)).toBe(7.5);
    expect(String(rows[0].UserID).trim()).toBe('1026');
    expect(rows[0].Description).toContain(`idempotency_${ids('shr1')}`);
    // the same id as savings is a conflict, and the list shows both kinds with the app's own id
    const clash = await post({ localTransactionId: ids('shr1'), memberCode: '209', accountId: 182495, amount: '7.50', collectedAt: collectedAt() });
    expect(clash.statusCode).toBe(409);
    const list = (await app.inject({ method: 'GET', url: '/v1/deposits?limit=50', headers: { authorization: auth } })).json().items;
    const mine = list.filter((i: { localTransactionId: string }) => i.localTransactionId.startsWith(RUN));
    expect(mine.map((i: { kind: string }) => i.kind).sort()).toEqual(['SAVINGS', 'SHARES']);
    expect(mine.every((i: { status: string }) => i.status === 'PENDING')).toBe(true);
    await notifier.idle();
  });

  test('an older row stored under the bare id is still a duplicate', async () => {
    await q(
      `INSERT SavingsTransaction (SerialNo, SavingsAccountID, CustomerCode, TransactionDate, SavingsCode, TransactionType, Credit, Balance, Description, ReferenceNumber, PaymentMethod, BranchCode, UserID, IsReversed, IsActive, BankingType, Status)
       VALUES (@s, 182495, 209, CAST(GETDATE() AS date), 'MS', 'DEPOSIT', 5.00, 5.00, 'old', @r, 'CASH', '100', '1026', 0, 1, 'MOBILE-BANKING', 'PENDING')`,
      { s: 1_900_000_000 + Math.floor(Math.random() * 90_000_000), r: ids('old1') },
    );
    const res = await post({ localTransactionId: ids('old1'), memberCode: '209', accountId: 182495, amount: '5.00', collectedAt: collectedAt() });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('DUPLICATE');
    const list = (await app.inject({ method: 'GET', url: '/v1/deposits?limit=50', headers: { authorization: auth } })).json().items;
    expect(list.some((i: { localTransactionId: string }) => i.localTransactionId === ids('old1'))).toBe(true);
  });

  test.each([
    ['SHARES', 'shr-c', { kind: 'SHARES', memberCode: '181', accountId: 24716 }],
    ['SAVINGS', 'sav-c', { memberCode: '209', accountId: 182495 }],
  ])('10 simultaneous identical %s deposits store exactly one row', async (kind, tag, target) => {
    const payload = { localTransactionId: ids(tag), amount: '3.21', collectedAt: collectedAt(), ...target };
    const results = await Promise.all(Array.from({ length: 10 }, () => post(payload)));
    const codes = results.map((r) => r.statusCode).sort();
    console.log(`CONCURRENCY ${kind}`, JSON.stringify(codes));
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 200)).toHaveLength(9);
    const table = kind === 'SHARES' ? 'ShareTransaction' : 'SavingsTransaction';
    const rows = await q(`SELECT COUNT(*) AS n FROM ${table} WHERE ReferenceNumber IN (@a, @b)`, { a: ids(tag), b: `MOBIDEMP-${ids(tag)}` });
    expect(rows[0].n).toBe(1);
    await notifier.idle();
  }, 60_000);

  test('the same id sent at once as savings and as shares stores one row in total', async () => {
    const mk = (i: number) =>
      i % 2
        ? { localTransactionId: ids('mix'), kind: 'SHARES', memberCode: '181', accountId: 24716, amount: '2.00', collectedAt: collectedAt() }
        : { localTransactionId: ids('mix'), memberCode: '209', accountId: 182495, amount: '2.00', collectedAt: collectedAt() };
    const results = await Promise.all(Array.from({ length: 10 }, (_v, i) => post(mk(i))));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    const a = await q(`SELECT COUNT(*) AS n FROM SavingsTransaction WHERE ReferenceNumber = @r`, { r: `MOBIDEMP-${ids('mix')}` });
    const b = await q(`SELECT COUNT(*) AS n FROM ShareTransaction WHERE ReferenceNumber = @r`, { r: `MOBIDEMP-${ids('mix')}` });
    expect(a[0].n + b[0].n).toBe(1);
    await notifier.idle();
  }, 60_000);

  test('text messages: one per stored deposit, logged in SMSHistory, none for duplicates', async () => {
    await notifier.idle();
    // Both members have a mobile number. Stored deposits above: sav1, shr1, shr-c, sav-c, mix = 5.
    // The duplicates (old1, the repeats in the concurrency bursts) must have produced no text.
    const logged = await q(`SELECT COUNT(*) AS n, MIN(Status) AS s, MAX(Status) AS s2, MIN(Module) AS m, MIN(Origin) AS o, MIN(MessageType) AS t FROM SMSHistory WHERE ReferenceNo LIKE 'MOBIDEMP-itest%'`);
    const dups = await q(`SELECT ReferenceNo, COUNT(*) AS n FROM SMSHistory WHERE ReferenceNo LIKE 'MOBIDEMP-itest%' GROUP BY ReferenceNo HAVING COUNT(*) > 1`);
    console.log('SMS', JSON.stringify({ logged: logged[0], providerHits: hits.length, duplicatesLogged: dups.length }));
    expect(dups).toHaveLength(0);
    expect(logged[0]).toMatchObject({ n: 5, s: 'SENT', s2: 'SENT', m: 'MOBILE_BANKING', o: 'FIELD_SERVER', t: 'DEPOSIT_PENDING' });
    expect(hits).toHaveLength(5);
    expect(hits.every((h) => h.headers['api-key'] === 'itest-key')).toBe(true);
    expect(hits.map((h) => h.body.recipients[0]).sort()).toContain('0248306112');
    expect(hits[0].body.message).toMatch(/^Dear .+, GHS \d+\.\d\d received for your .+ account, pending approval\. Ref: /);
  });
});
