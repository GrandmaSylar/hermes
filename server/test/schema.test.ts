import bcrypt from 'bcryptjs';
import { describe, expect, test } from 'vitest';
import { buildApp } from '../src/app';
import { buildSchema, describe as describeSchema, nameExpr, product, SchemaError, type ColumnRow } from '../src/schema';
import { MemoryRepo } from './memory-repo';

const table = (t: string, cols: string[]): ColumnRow[] => cols.map((column) => ({ table: t, column }));

const SAVINGS_TX = ['SavingsTransactionID', 'SerialNo', 'SavingsAccountID', 'CustomerCode', 'TransactionDate', 'SavingsCode', 'TransactionType', 'Debit', 'Credit', 'Balance', 'Description', 'ReferenceNumber', 'PaymentMethod', 'BranchCode', 'UserID', 'IsReversed', 'IsActive', 'BankingType', 'Status', 'CreatedAt', 'UpdatedAt', 'ApprovedAt'];
const SHARE_TX = ['ShareTransactionID', 'SerialNo', 'ShareHoldingID', 'CustomerCode', 'TransactionDate', 'ShareCode', 'TransactionType', 'TransactionAmount', 'Credit', 'Description', 'ReferenceNumber', 'ValueDate', 'UserID', 'BankingType', 'Status', 'CreatedAt'];

const REGISTRATION_TABLES = [
  ...table('CustomerType', ['Code', 'Description']),
  ...table('CustomerContact', ['CustomerID', 'PhoneNo', 'EmailAddress', 'ContactValue']),
  ...table('CustomerAddress', ['CustomerID', 'AddressTypeID', 'ResidentialAddress', 'City', 'Region']),
  ...table('CustomerFinancial', ['CustomerID']),
  ...table('CustomerEmployment', ['CustomerID']),
  ...table('CustomerBeneficiary', ['CustomerID', 'PercentAllot']),
  ...table('CustomerAlertPreferences', ['CustomerID']),
  ...table('CustomerGuardian', ['CustomerID']),
  ...table('CustomerCompliance', ['CustomerID']),
  ...table('CustomerMedia', ['CustomerID', 'MainPicture', 'MainSignature', 'NationalIdentity', 'PictureTwo', 'CreatedAt']),
  ...table('FieldOfficerFavorite', ['FieldOfficerID', 'MemberCode', 'IsActive']),
];

function rows(over: { oldProducts?: boolean; noShares?: boolean; noSms?: boolean; noRegistration?: boolean } = {}): ColumnRow[] {
  const base = [
    ...table('FieldOfficer', ['FieldOfficerID', 'Username', 'PasswordHash', 'BranchCode', 'EmployeeID', 'FullName', 'IsActive', 'UsrEnabled']),
    ...table('Customer', ['Code', 'FullName', 'BranchCode', 'CustomerID', 'FirstName', 'LastName', 'MiddleName', 'BirthDate', 'DateRegistered', 'CustomerType', 'Sex', 'MaritalStatus', 'MemberType', 'NationalID', 'RegistrationNo', 'StaffNo', 'CreatedBy', 'CreatedAt', 'AccountType', 'PhoneNo', 'StatusCode', 'IsActive']),
    ...(over.noRegistration ? [] : REGISTRATION_TABLES),
    ...table('SavingsAccount', ['SavingsAccountID', 'CustomerCode', 'SavingsProductCode', 'AccountNumber', 'CurrentBalance', 'AccountStatus', 'IsDormant', 'DateClosed', 'DateOpened', 'BranchCode']),
    ...table('SavingsProduct', over.oldProducts
      ? ['Code', 'Description', 'ProductName', 'MinimumBalance']
      : ['Code', 'Description', 'ProductName', 'IsActive', 'MinimumDeposit', 'MaximumDeposit']),
    ...table('SavingsTransaction', SAVINGS_TX),
  ];
  const shares = over.noShares
    ? []
    : [
        ...table('ShareHolding', ['ShareHoldingID', 'CustomerCode', 'ShareProductCode', 'ShareAccountNumber', 'PaidUpValue', 'ShareStatus', 'DateClosed']),
        ...table('ShareProduct', over.oldProducts ? ['Code', 'Description', 'ProductName', 'ParValue'] : ['Code', 'ProductName', 'IsActive', 'MinPurchaseAmount', 'MaxPurchaseAmount']),
        ...table('ShareTransaction', SHARE_TX),
      ];
  const sms = over.noSms
    ? []
    : [
        ...table('AppSettings', ['Key', 'Value']),
        ...table('SMSHistory', ['ID', 'PhoneNumber', 'Message', 'MessageType', 'Status', 'ReferenceNo']),
        ...table('CustomerContact', ['CustomerID', 'PhoneNo']),
      ];
  return [...base, ...shares, ...sms];
}

describe('schema probe', () => {
  test('the full schema turns every rule on', () => {
    const { schema } = buildSchema(rows());
    const flags = describeSchema(schema);
    expect(Object.values(flags).every(Boolean)).toBe(true);
    const sp = product(schema, 'SAVINGS', 'a');
    expect(sp.activeCondition).toContain('IsActive');
    expect(sp.min).toContain('MinimumDeposit');
    expect(sp.max).toContain('MaximumDeposit');
  });

  test('registration is off until the registration tables are visible to the login', () => {
    const { schema } = buildSchema(rows({ noRegistration: true }));
    expect(describeSchema(schema).registrationEnabled).toBe(false);
    expect(describeSchema(buildSchema(rows()).schema).registrationEnabled).toBe(true);
  });

  test('an old schema skips the product rules and never mentions the missing columns', () => {
    const { schema } = buildSchema(rows({ oldProducts: true }));
    const flags = describeSchema(schema);
    expect(flags).toMatchObject({
      sharesEnabled: true,
      savingsProductActiveRule: false,
      savingsMinDepositRule: false,
      savingsMaxDepositRule: false,
      shareProductActiveRule: false,
      shareMinPurchaseRule: false,
      shareMaxPurchaseRule: false,
      savingsDormantRule: true,
    });
    for (const [kind, alias] of [['SAVINGS', 'a'], ['SHARES', 'h']] as const) {
      const p = product(schema, kind, alias);
      const text = JSON.stringify(p);
      expect(text).not.toMatch(/IsActive = 1|MinimumDeposit|MaximumDeposit|MinPurchase|MaxPurchase/);
      expect(p.min).toMatch(/NULL/);
      expect(p.active).toBe('CAST(1 AS bit)');
      // product name falls back ProductName -> Description -> Code
      expect(p.name).toBe(`COALESCE(NULLIF(RTRIM(pr.ProductName), ''), NULLIF(RTRIM(pr.Description), ''), RTRIM(${alias}.${kind === 'SAVINGS' ? 'SavingsProductCode' : 'ShareProductCode'}))`);
    }
  });

  test('without a product table the name is the product code', () => {
    const noProduct = rows().filter((r) => r.table !== 'SavingsProduct');
    const { schema } = buildSchema(noProduct);
    const p = product(schema, 'SAVINGS', 'a');
    expect(p.join).toBe('');
    expect(p.name).toBe('COALESCE(RTRIM(a.SavingsProductCode))');
  });

  test('missing share tables mean savings-only, not a failure', () => {
    const { schema, sharesMissing } = buildSchema(rows({ noShares: true }));
    expect(schema.shares).toBe(false);
    expect(sharesMissing.length).toBeGreaterThan(0);
    expect(describeSchema(schema)).toMatchObject({ sharesEnabled: false, shareProductActiveRule: false, shareClosedRule: false });
  });

  test('missing SMS tables quietly turn texts off', () => {
    const { schema, smsMissing } = buildSchema(rows({ noSms: true }));
    expect(schema.sms).toBe(false);
    expect(smsMissing).toContain('AppSettings.Key');
    expect(schema.shares).toBe(true);
  });

  test('a database missing the minimum fails with one message listing what is missing', () => {
    const broken = rows().filter((r) => !(r.table === 'SavingsAccount' && r.column === 'CurrentBalance') && r.table !== 'FieldOfficer');
    expect(() => buildSchema(broken)).toThrow(SchemaError);
    expect(() => buildSchema(broken)).toThrow(/SavingsAccount\.CurrentBalance.*FieldOfficer\.PasswordHash|FieldOfficer\.FieldOfficerID/s);
  });
});

describe('when the database has no share tables', () => {
  test('a share deposit is refused clearly, and /health shows the switches', async () => {
    const repo = new MemoryRepo();
    repo.describeSchema = () => describeSchema(buildSchema(rows({ noShares: true })).schema);
    repo.officers = [{ id: '1', staffId: 'a', fullName: 'A', branchCode: '100', passwordHash: bcrypt.hashSync('1234', 4), active: true }];
    const app = buildApp({
      config: {
        port: 0, host: '', jwtSecret: 'x'.repeat(40), accessTtlSeconds: 1800, refreshTtlSeconds: 1800,
        db: { server: '', port: 0, database: '', user: '', password: '', encrypt: false, trustServerCertificate: true },
        limits: { maxSingleAmount: '5000.00', maxUnsyncedAmount: '1.00', maxUnsyncedItems: 1 }, maxBackdateDays: 7, pinMaxAttempts: 3, pinLockoutMinutes: 1, smsPendingEnabled: false,
      },
      repo,
    });
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'a', pin: '1234', deviceId: 'device-0001' } });
    const res = await app.inject({
      method: 'POST', url: '/v1/deposits', headers: { authorization: `Bearer ${login.json().accessToken}` },
      payload: { localTransactionId: 'txn-00000001', kind: 'SHARES', memberCode: '10', accountId: 1, amount: '5.00', collectedAt: new Date().toISOString() },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().reason).toMatch(/not available on this system/);
    const health = (await app.inject({ method: 'GET', url: '/health' })).json();
    expect(health.schema.sharesEnabled).toBe(false);
  });
});

describe('member display name', () => {
  test('falls back to first, middle and last name when FullName is empty', () => {
    const { schema } = buildSchema([...rows(), ...table('Customer', ['MiddleName', 'LastName'])]);
    const sql = nameExpr(schema);
    expect(sql).toContain('c.FullName');
    expect(sql).toContain('c.FirstName');
    expect(sql).toContain('c.MiddleName');
    expect(sql).toContain('c.LastName');
  });

  test('uses FullName alone when the name parts do not exist', () => {
    const { schema } = buildSchema(rows().filter((r) => !(r.table === 'Customer' && ['FirstName', 'MiddleName', 'LastName'].includes(r.column))));
    expect(nameExpr(schema)).toBe('c.FullName');
  });
});
