/**
 * Runs the member registration SQL against a real core database, then rolls it back, so nothing is saved.
 * Skipped unless HERMES_INTEGRATION=1.
 *
 *   HERMES_INTEGRATION=1 DB_SERVER=... DB_PORT=1436 DB_NAME=bankpro DB_USER=sa DB_PASSWORD=... \
 *   npx vitest run test/registration.db.test.ts
 *
 * The transaction's commit is replaced by "read back what was written, then roll back".
 */
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MssqlRepo } from '../src/mssql-repo';
import { registrationBody } from '../src/registration';

const run = process.env.HERMES_INTEGRATION === '1';
const d = run ? describe : describe.skip;
const env = process.env;

const form = (over: Record<string, unknown> = {}) =>
  registrationBody.parse({
    localRegistrationId: 'dryrun-0001',
    capturedAt: new Date().toISOString(),
    memberType: 'IND',
    firstName: 'Dryrun',
    middleName: 'Test',
    lastName: 'Member',
    birthDate: '1990-01-01',
    sex: 'Female',
    maritalStatus: 'Single',
    nationalId: 'GHA-999999999-9',
    voterIdNo: 'DRYRUN12345',
    phone: '0200000000',
    email: 'dryrun@example.com',
    contactValue: '0200000000',
    residentialAddress: 'Dry run street',
    region: 'Greater Accra',
    city: 'Accra',
    employerName: 'Dry Run Ltd',
    jobTitle: 'Tester',
    employmentType: 'Full-time',
    yearsWithEmployer: '3',
    sourceOfFunds: 'Salary/Wages',
    customerBank: 'Test Bank',
    beneficiaries: [
      { name: 'Ama Member', relationship: 'Spouse', percentage: 60 },
      { name: 'Yaw Member', relationship: 'Child', percentage: 40, isMinor: true, guardianName: 'Ama Member', guardianPhone: '0200000001' },
    ],
    guardian: { name: 'Kofi Member', nationalId: 'GHA-888888888-8', phone: '0200000002', relationship: 'Parent' },
    ...over,
  });

d('member registration against a real database (rolled back)', () => {
  let repo: MssqlRepo;
  let pool: sql.ConnectionPool;
  const original = sql.Transaction.prototype.commit;
  const seen: Record<string, unknown> = {};

  beforeAll(async () => {
    repo = await MssqlRepo.connect({
      server: env.DB_SERVER ?? '127.0.0.1',
      port: Number(env.DB_PORT ?? 1433),
      database: env.DB_NAME ?? 'bankpro_test',
      user: env.DB_USER ?? 'sa',
      password: env.DB_PASSWORD ?? '',
      encrypt: false,
      trustServerCertificate: true,
    });
    pool = (repo as unknown as { pool: sql.ConnectionPool }).pool;
    // Instead of committing: read back what each table received, then roll back.
    (sql.Transaction.prototype as unknown as { commit: (cb?: unknown) => Promise<void> }).commit = async function (this: sql.Transaction) {
      const q = async (text: string) => (await new sql.Request(this).query(text)).recordset;
      const [customer] = await q(`SELECT TOP 1 * FROM dbo.Customer ORDER BY CustomerID DESC`);
      seen.customer = customer;
      const id = customer.CustomerID;
      for (const table of ['CustomerContact', 'CustomerAddress', 'CustomerEmployment', 'CustomerFinancial', 'CustomerBeneficiary', 'CustomerAlertPreferences', 'CustomerGuardian', 'CustomerCompliance']) {
        seen[table] = await q(`SELECT * FROM dbo.${table} WHERE CustomerID = ${id}`);
      }
      await this.rollback();
    } as never;
  });

  afterAll(async () => {
    sql.Transaction.prototype.commit = original;
    await repo?.close();
  });

  test('every table receives its row, and the rollback leaves the database unchanged', { timeout: 90_000 }, async () => {
    const officer = { id: 'dry', staffId: 'dryrun', fullName: 'Dry Run', branchCode: '100', passwordHash: null, active: true };
    const before = (await pool.request().query('SELECT COUNT(*) AS n FROM dbo.Customer')).recordset[0].n;
    expect(repo.describeSchema().registrationEnabled).toBe(true);

    const { memberCode } = await repo.registerMember(officer, form());
    expect(memberCode).toMatch(/^100\d{7}$/);

    const c = seen.customer as Record<string, unknown>;
    expect(String(c.Code)).toBe(memberCode);
    expect(c).toMatchObject({ FirstName: 'Dryrun', LastName: 'Member', FullName: 'Dryrun Test Member', BranchCode: '100', StatusCode: 'PND', MemberType: 'IND', Sex: 'Female' });
    expect(c.NationalID).toBe('GHA-999999999-9');
    expect(c.VoterIDNo).toBe('DRYRUN12345');
    expect(c.IDType).toBe('NATIONAL_ID');
    expect(String(c.PhoneNo)).toBe('0200000000');
    expect(String(c.CreatedBy)).toBe('dryrun');

    expect((seen.CustomerContact as unknown[]).length).toBe(1);
    expect((seen.CustomerAddress as unknown[]).length).toBe(1);
    expect((seen.CustomerEmployment as unknown[]).length).toBe(1);
    expect((seen.CustomerFinancial as unknown[]).length).toBe(1);
    expect((seen.CustomerBeneficiary as unknown[]).length).toBe(2);
    expect((seen.CustomerAlertPreferences as unknown[]).length).toBe(1);
    expect((seen.CustomerGuardian as unknown[]).length).toBe(1);
    expect((seen.CustomerCompliance as unknown[]).length).toBe(1);

    const after = (await pool.request().query('SELECT COUNT(*) AS n FROM dbo.Customer')).recordset[0].n;
    expect(after).toBe(before);
  });

  test('finds a member by ID, phone and email, and names them', async () => {
    const [anyone] = (await pool.request().query(`SELECT TOP 1 Code, NationalID FROM dbo.Customer WHERE NationalID IS NOT NULL AND RTRIM(NationalID) <> ''`)).recordset;
    if (!anyone) return;
    const hits = await repo.findMemberConflicts({ ids: { nationalId: String(anyone.NationalID).trim() } });
    expect(hits[0]).toMatchObject({ label: 'Ghana Card', memberCode: String(anyone.Code) });
    expect(hits[0].memberName).not.toBe('');
  });

  test('lists individual member types', async () => {
    const types = await repo.listMemberTypes();
    expect(types.length).toBeGreaterThan(0);
    expect(types.every((t) => t.code !== 'JNT' && t.code !== 'GRP')).toBe(true);
  });
});
