import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../src/app';
import type { Config } from '../src/config';
import { checkDocument, sniffMime } from '../src/documents';
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

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const PDF = Buffer.from('%PDF-1.4\n%fake');
const b64 = (b: Buffer) => b.toString('base64');

let repo: MemoryRepo;
let app: ReturnType<typeof buildApp>;
let auth: string;
let other: string;

const registration = {
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
};

async function login(username: string) {
  const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username, pin: '1234', deviceId: `device-${username}` } });
  return `Bearer ${res.json().accessToken}`;
}

async function memberCode(): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/v1/registrations', headers: { authorization: auth }, payload: registration });
  return res.json().serverId;
}

const upload = (code: string, body: unknown, token = auth) =>
  app.inject({ method: 'POST', url: `/v1/members/${code}/documents`, headers: { authorization: token }, payload: body as object });

beforeEach(async () => {
  repo = new MemoryRepo();
  const hash = bcrypt.hashSync('1234', 4);
  repo.officers = [
    { id: '1006', staffId: 'mabel', fullName: 'Mabel', branchCode: '100', passwordHash: hash, active: true },
    { id: '1007', staffId: 'kofi', fullName: 'Kofi', branchCode: '100', passwordHash: hash, active: true },
  ];
  app = buildApp({ config, repo, now: () => NOW });
  auth = await login('mabel');
  other = await login('kofi');
});

describe('what a file is', () => {
  test('is read from its first bytes, not its name', () => {
    expect(sniffMime(JPEG)).toBe('image/jpeg');
    expect(sniffMime(PNG)).toBe('image/png');
    expect(sniffMime(PDF)).toBe('application/pdf');
    expect(sniffMime(Buffer.from('MZ not a picture'))).toBeNull();
  });

  test('a photo must be a picture, an ID card or proof of address may be a PDF', () => {
    expect(checkDocument({ kind: 'passportPhoto', fileName: 'a.jpg', dataBase64: b64(JPEG) })).toMatchObject({ mimeType: 'image/jpeg' });
    expect(checkDocument({ kind: 'passportPhoto', fileName: 'a.pdf', dataBase64: b64(PDF) })).toEqual({ problem: 'Passport photo must be a JPG, PNG or GIF picture.' });
    expect(checkDocument({ kind: 'proofOfAddress', fileName: 'bill.pdf', dataBase64: b64(PDF) })).toMatchObject({ mimeType: 'application/pdf' });
    expect(checkDocument({ kind: 'signature', fileName: 'x', dataBase64: b64(Buffer.from('not an image at all')) })).toEqual({
      problem: 'Signature must be a JPG, PNG or GIF picture.',
    });
  });

  test('a file over 5 MB is refused, and a path in the name is cut down to the file name', () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]);
    expect(checkDocument({ kind: 'idFront', fileName: 'x', dataBase64: b64(big) })).toEqual({ problem: 'ID card (front) is larger than 5 MB.' });
    const ok = checkDocument({ kind: 'idFront', fileName: '../../etc/passwd\\evil name.jpg', dataBase64: b64(JPEG) });
    expect(ok).toMatchObject({ fileName: 'evil name.jpg' });
  });
});

describe('POST /v1/members/:code/documents', () => {
  test('saves a file for the own pending member, and a second one of the same kind replaces it', async () => {
    const code = await memberCode();
    const first = await upload(code, { kind: 'passportPhoto', fileName: 'me.jpg', dataBase64: b64(JPEG) });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ status: 'SAVED', kind: 'passportPhoto' });
    const second = await upload(code, { kind: 'passportPhoto', fileName: 'me2.png', dataBase64: b64(PNG) });
    expect(second.statusCode).toBe(200);
    expect(repo.documents.size).toBe(1);
    expect(repo.documents.get(`${code}:passportPhoto`)?.mimeType).toBe('image/png');
  });

  test('another banker cannot add to the member, and cannot tell the member exists', async () => {
    const code = await memberCode();
    const res = await upload(code, { kind: 'signature', dataBase64: b64(PNG) }, other);
    expect(res.statusCode).toBe(404);
    expect(repo.documents.size).toBe(0);
  });

  test('an approved member can no longer be changed from the phone', async () => {
    const code = await memberCode();
    repo.approved.add(code);
    const res = await upload(code, { kind: 'signature', dataBase64: b64(PNG) });
    expect(res.statusCode).toBe(409);
    expect(res.json().status).toBe('CONFLICT');
  });

  test('a file that is not what it says is refused with the reason', async () => {
    const code = await memberCode();
    const res = await upload(code, { kind: 'passportPhoto', fileName: 'virus.jpg', dataBase64: b64(Buffer.from('MZ executable')) });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ status: 'REJECTED', reason: 'Passport photo must be a JPG, PNG or GIF picture.' });
  });

  test('an unknown kind or member number is refused', async () => {
    const code = await memberCode();
    expect((await upload(code, { kind: 'selfie', dataBase64: b64(JPEG) })).statusCode).toBe(400);
    expect((await upload('abc', { kind: 'signature', dataBase64: b64(PNG) })).statusCode).toBe(400);
    expect((await upload('9999999999', { kind: 'signature', dataBase64: b64(PNG) })).statusCode).toBe(404);
  });

  test('is off until the database allows it, and needs a signed-in banker', async () => {
    const code = await memberCode();
    repo.documentsEnabled = false;
    expect((await upload(code, { kind: 'signature', dataBase64: b64(PNG) })).statusCode).toBe(503);
    const anonymous = await app.inject({ method: 'POST', url: `/v1/members/${code}/documents`, payload: { kind: 'signature', dataBase64: b64(PNG) } });
    expect(anonymous.statusCode).toBe(401);
  });

  test('/me says whether files can be uploaded', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: auth } })).json().capabilities.documents).toBe(true);
    repo.documentsEnabled = false;
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: auth } })).json().capabilities.documents).toBe(false);
  });
});

describe('stored logo', () => {
  test('accepts a picture data URL and fingerprints it', async () => {
    const { logoFrom } = await import('../src/documents');
    const a = logoFrom('data:image/jpeg;base64,/9j/4AAQ');
    expect(a?.dataUri).toBe('data:image/jpeg;base64,/9j/4AAQ');
    expect(logoFrom('data:image/jpeg;base64,/9j/4AAR')?.version).not.toBe(a?.version);
  });
  test('leaves out anything else', async () => {
    const { logoFrom } = await import('../src/documents');
    expect(logoFrom(null)).toBeNull();
    expect(logoFrom('')).toBeNull();
    expect(logoFrom('C:/logos/a.png')).toBeNull();
    expect(logoFrom('data:text/html;base64,PGI+')).toBeNull();
    expect(logoFrom(`data:image/png;base64,${'A'.repeat(1_600_000)}`)).toBeNull();
  });
});
