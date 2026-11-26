import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../src/app';
import type { Config } from '../src/config';
import {
  ageOn,
  formatGhanaCard,
  isFullName,
  isGhanaPhone,
  normaliseIdNumber,
  primaryIdType,
  registrationBody,
  registrationProblems,
} from '../src/registration';
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

/** A complete, valid adult registration. Tests change one thing at a time. */
const form = (over: Record<string, unknown> = {}) => ({
  localRegistrationId: 'reg-00000001',
  capturedAt: '2026-11-25T11:00:00.000Z',
  memberType: 'IND',
  firstName: 'Samuel',
  lastName: 'Akuffo',
  birthDate: '1990-01-01',
  sex: 'Male',
  nationalId: 'GHA-123456789-0',
  phone: '0244123456',
  residentialAddress: 'House 4, Kasoa',
  region: 'Central',
  city: 'Kasoa',
  beneficiaries: [{ name: 'Ama Akuffo', relationship: 'Spouse', percentage: 100 }],
  ...over,
});

let repo: MemoryRepo;
let app: ReturnType<typeof buildApp>;
let auth: string;

async function setup() {
  repo = new MemoryRepo();
  repo.officers = [{ id: '1006', staffId: 'mabel', fullName: 'Mabel', branchCode: '100', passwordHash: bcrypt.hashSync('1234', 4), active: true }];
  app = buildApp({ config, repo, now: () => NOW });
  const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'mabel', pin: '1234', deviceId: 'device-0001' } });
  auth = `Bearer ${res.json().accessToken}`;
}
const post = (payload: unknown) => app.inject({ method: 'POST', url: '/v1/registrations', headers: { authorization: auth }, payload: payload as object });

describe('registration rules', () => {
  const problems = (over: Record<string, unknown>) => registrationProblems(registrationBody.parse(form(over)), NOW);

  test('a complete adult registration has no problems', () => {
    expect(problems({})).toEqual([]);
  });

  test('required personal fields', () => {
    expect(problems({ firstName: '' })).toContain('First Name is required');
    expect(problems({ lastName: ' ' })).toContain('Last Name is required');
    expect(problems({ sex: '' })).toContain('Gender is required');
    expect(problems({ birthDate: '' })).toContain('Date of Birth is required');
    expect(problems({ birthDate: '1990-02-31' })).toContain('Invalid Date of Birth');
    expect(problems({ birthDate: '2027-01-01' })).toContain('Date of Birth cannot be in the future');
  });

  test('any one ID will do, and each ID given must be well formed', () => {
    expect(problems({ nationalId: '', voterIdNo: 'AB12345678' })).toEqual([]);
    expect(problems({ nationalId: '', nhisNo: 'NH-12345' })).toEqual([]);
    expect(problems({ nationalId: '', passportNo: 'G1234567' })).toEqual([]);
    expect(problems({ nationalId: '' })).toContain('Enter at least one ID: Ghana Card, voter ID, NHIS card or passport.');
    expect(problems({ nationalId: 'GHA-12-3' })).toContain('Ghana Card number must look like GHA-123456789-0.');
    expect(problems({ voterIdNo: 'abc' })).toContain('Voter ID should be 6 to 15 letters or digits.');
  });

  test('phone, email and address', () => {
    expect(problems({ phone: '12345' })).toContain('Invalid primary phone number');
    expect(problems({ phone: '+233 24 412 3456' })).toEqual([]);
    expect(problems({ email: 'nope' })).toContain('Invalid email address format');
    expect(problems({ email: 'kofi@example.com' })).toEqual([]);
    expect(problems({ residentialAddress: '' })).toContain('Residential Address is required');
    expect(problems({ region: '' })).toContain('Region is required');
    expect(problems({ city: '' })).toContain('City is required');
    expect(problems({ mobileAlert: '999' })).toContain('Invalid mobile alert number');
  });

  test('a minor needs a guardian with an ID and a valid phone', () => {
    const minor = { birthDate: '2015-06-01' };
    expect(problems(minor)).toContain('Guardian information required for minor accounts');
    expect(problems({ ...minor, guardian: { name: 'Kofi Boateng' } })).toEqual(
      expect.arrayContaining([
        'Guardian ID number is required (Ghana Card, voter ID, NHIS or passport)',
        'Guardian phone number is required and must be valid',
      ]),
    );
    expect(problems({ ...minor, guardian: { name: 'Kofi Boateng', nationalId: 'GHA-111111111-1', phone: '0201234567' } })).toEqual([]);
  });

  test('a Kiddy Savings member needs a guardian whatever the birth date says', () => {
    expect(problems({ memberType: 'KID' })).toContain('Guardian information required for minor accounts');
    expect(problems({ memberType: 'KID', guardian: { name: 'Kofi Boateng', nationalId: 'GHA-111111111-1', phone: '0201234567' } })).toEqual([]);
  });

  test('beneficiaries must total 100% and have two names', () => {
    expect(problems({ beneficiaries: [] })).toContain('Beneficiaries must total 100% (current 0%)');
    expect(problems({ beneficiaries: [{ name: 'Ama Akuffo', relationship: 'Spouse', percentage: 60 }] })).toContain('Beneficiaries must total 100% (current 60%)');
    expect(
      problems({
        beneficiaries: [
          { name: 'Ama Akuffo', relationship: 'Spouse', percentage: 33.3 },
          { name: 'Yaw Akuffo', relationship: 'Child', percentage: 66.7 },
        ],
      }),
    ).toEqual([]);
    expect(problems({ beneficiaries: [{ name: 'Ama', relationship: 'Spouse', percentage: 100 }] })).toContain('Beneficiary 1: full name must include at least two names');
    expect(
      problems({ beneficiaries: [{ name: 'Ama Akuffo', relationship: 'Child', percentage: 100, isMinor: true }] }),
    ).toEqual(expect.arrayContaining(['Beneficiary 1: guardian name required', 'Beneficiary 1: invalid guardian phone']));
  });

  test('only individual member types can be registered', () => {
    expect(problems({ memberType: 'JNT' })).toContain('Only individual members can be registered from the field.');
  });
});

describe('field helpers', () => {
  test('Ghana Card is laid out as typed digits arrive', () => {
    expect(formatGhanaCard('')).toBe('');
    expect(formatGhanaCard('gha123')).toBe('GHA-123');
    expect(formatGhanaCard('1234567890')).toBe('GHA-123456789-0');
    expect(formatGhanaCard('GHA-123456789-0')).toBe('GHA-123456789-0');
  });
  test('other IDs are upper-cased with spaces removed', () => {
    expect(normaliseIdNumber('VOTER_ID', ' ab 1234 56 ')).toBe('AB123456');
  });
  test('the stored ID type is the first ID given', () => {
    expect(primaryIdType({ nationalId: 'GHA-123456789-0', passportNo: 'G1234567' })).toBe('NATIONAL_ID');
    expect(primaryIdType({ passportNo: 'G1234567' })).toBe('PASSPORT');
    expect(primaryIdType({})).toBeNull();
  });
  test('phone, full name and age', () => {
    expect(isGhanaPhone('0244123456')).toBe(true);
    expect(isGhanaPhone('+233244123456')).toBe(true);
    expect(isGhanaPhone('244123456')).toBe(false);
    expect(isFullName('Ama Akuffo')).toBe(true);
    expect(isFullName("Ama O'Neil-Mensah")).toBe(true);
    expect(isFullName('Ama')).toBe(false);
    expect(ageOn('2008-11-26', NOW)).toBe(17);
    expect(ageOn('2008-11-25', NOW)).toBe(18);
    expect(ageOn('nonsense', NOW)).toBeNull();
  });
});

describe('POST /v1/registrations', () => {
  beforeEach(() => setup());

  test('creates a pending member and returns its code', async () => {
    const res = await post(form());
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: 'ACCEPTED', localRegistrationId: 'reg-00000001', serverId: '1000004000' });
    expect(repo.registered).toHaveLength(1);
    expect(repo.registered[0]).toMatchObject({ by: 'mabel', branchCode: '100' });
  });

  test('tidies ID numbers before saving', async () => {
    await post(form({ nationalId: 'gha1234567890' }));
    expect(repo.registered[0].body.nationalId).toBe('GHA-123456789-0');
  });

  test('a rule failure is refused with the reasons, and nothing is saved', async () => {
    const res = await post(form({ firstName: '', phone: '123' }));
    expect(res.statusCode).toBe(422);
    expect(res.json().status).toBe('REJECTED');
    expect(res.json().reason).toContain('First Name is required');
    expect(res.json().reason).toContain('Invalid primary phone number');
    expect(repo.registered).toHaveLength(0);
  });

  test('an ID that belongs to another member is refused, naming them', async () => {
    repo.existing = [{ code: '1000000007', name: 'Kofi Mensah', nationalId: 'GHA-123456789-0' }];
    const res = await post(form());
    expect(res.statusCode).toBe(422);
    expect(res.json().reason).toBe('Ghana Card GHA-123456789-0 already belongs to Kofi Mensah (member 1000000007).');
    expect(repo.registered).toHaveLength(0);
  });

  test('a phone number or email in use is refused', async () => {
    repo.existing = [{ code: '1000000008', name: 'Esi Owusu', phone: '0244123456' }];
    expect((await post(form())).json().reason).toBe('Phone 0244123456 already in use by Esi Owusu (Code 1000000008).');
    repo.existing = [{ code: '1000000009', name: 'Yaw Boateng', email: 'a@b.com' }];
    expect((await post(form({ email: 'A@B.com' }))).json().reason).toBe('Email A@B.com already in use by Yaw Boateng (Code 1000000009).');
  });

  test('sending the same registration again returns the same member instead of a second one', async () => {
    const first = await post(form());
    const again = await post(form());
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ status: 'DUPLICATE', serverId: first.json().serverId });
    expect(repo.registered).toHaveLength(1);
  });

  test('an unknown or group member type is refused', async () => {
    expect((await post(form({ memberType: 'XYZ' }))).json().reason).toBe('That member type is not available.');
    expect((await post(form({ memberType: 'JNT' }))).statusCode).toBe(422);
  });

  test('switched off until the database allows it', async () => {
    repo.registrationEnabled = false;
    const res = await post(form());
    expect(res.statusCode).toBe(503);
    expect(repo.registered).toHaveLength(0);
  });

  test('needs a signed-in banker', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/registrations', payload: form() });
    expect(res.statusCode).toBe(401);
  });
});

describe('member types, duplicate check and capability', () => {
  beforeEach(() => setup());

  test('lists individual member types only, with their rules', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/member-types', headers: { authorization: auth } });
    expect(res.json().items).toEqual([
      { code: 'IND', label: 'INDIVIDUAL', sharesOptional: false, guardianRequired: false },
      { code: 'KID', label: 'KIDDY SAVINGS', sharesOptional: true, guardianRequired: true },
    ]);
  });

  test('the live check names who already holds an ID or phone', async () => {
    repo.existing = [{ code: '1000000007', name: 'Kofi Mensah', voterIdNo: 'AB1234567', phone: '0244000000' }];
    const res = await app.inject({
      method: 'POST',
      url: '/v1/members/check',
      headers: { authorization: auth },
      payload: { voterIdNo: 'ab 1234567', phone: '0244000000' },
    });
    expect(res.json().conflicts).toEqual([
      { label: 'Voter ID', value: 'AB1234567', memberCode: '1000000007', memberName: 'Kofi Mensah' },
      { label: 'Phone', value: '0244000000', memberCode: '1000000007', memberName: 'Kofi Mensah' },
    ]);
  });

  test('/me tells the app whether registration is on', async () => {
    const on = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: auth } });
    expect(on.json().capabilities).toEqual({ registration: true, documents: true });
    repo.registrationEnabled = false;
    const off = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: auth } });
    expect(off.json().capabilities).toEqual({ registration: false, documents: false });
  });

  test('/me names the branch and credit union, or null when they cannot be read', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: auth } });
    expect(res.json().branch).toEqual({ code: '001', name: 'Techiman Branch', city: 'Techiman', creditUnion: 'Test Credit Union' });
    repo.branch = null;
    const none = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: auth } });
    expect(none.json().branch).toBeNull();
  });
});
