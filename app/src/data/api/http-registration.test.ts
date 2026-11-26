import { DEFAULT_MEMBER_TYPES, toPayload } from '@/domain/registration';
import type { Session } from '@/domain/types';
import { validForm } from '@/test/registration-form';
import { HttpApi } from './http';

/** The registration calls of the HTTP client, against a fake field server. */

interface Recorded {
  method: string;
  path: string;
  body: unknown;
}
type Route = () => { status: number; body?: unknown };

function make(routes: Record<string, Route>) {
  const calls: Recorded[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = url.replace('https://field.test', '');
    calls.push({ method: init.method ?? 'GET', path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const route = routes[`${init.method ?? 'GET'} ${path.split('?')[0]}`];
    if (!route) throw new Error(`unexpected request ${init.method} ${path}`);
    const answer = route();
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => answer.body ?? null } as Response;
  }) as unknown as typeof fetch;
  return { api: new HttpApi({ baseUrl: 'https://field.test/', fetchImpl }), calls };
}

const session: Session = {
  officerId: '1006',
  officerName: 'Mabel Asare',
  branchCode: '100',
  deviceId: 'device-abcdef-1',
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  limits: { maxUnsyncedItems: 200, maxUnsyncedAmount: '20000.00', maxSingleAmount: '5000.00' },
};

const payload = () =>
  toPayload(validForm(), 'reg-00000001', '2026-11-25T11:00:00.000Z', DEFAULT_MEMBER_TYPES, new Date('2026-11-25T12:00:00.000Z'));

describe('member registration over HTTP', () => {
  test('registration is off until the server says it is on, and follows what it says', async () => {
    let on = false;
    const { api } = make({ 'GET /v1/me': () => ({ status: 200, body: { capabilities: { registration: on, documents: on } } }) });
    expect(api.capabilities.registration).toBe(false);
    await api.refreshCapabilities(session);
    expect(api.capabilities.registration).toBe(false);
    on = true;
    await api.refreshCapabilities(session);
    expect(api.capabilities.registration).toBe(true);
    expect(api.capabilities.documents).toBe(true);
    on = false;
    await api.refreshCapabilities(session);
    expect(api.capabilities.registration).toBe(false);
  });

  test('sends the whole form and reads the new member number', async () => {
    const { api, calls } = make({ 'POST /v1/registrations': () => ({ status: 201, body: { status: 'ACCEPTED', serverId: '1000004762' } }) });
    const [result] = await api.pushRegistrations(session, [payload()]);
    expect(result).toEqual({ localRegistrationId: 'reg-00000001', status: 'ACCEPTED', serverId: '1000004762' });
    expect(calls[0].body).toMatchObject({
      localRegistrationId: 'reg-00000001',
      firstName: 'Samuel',
      nationalId: 'GHA-123456789-0',
      region: 'Central',
      beneficiaries: [{ percentage: 100 }],
    });
  });

  test('a retry answered DUPLICATE counts as delivered, a refusal carries the reason', async () => {
    const answers = [
      { status: 200, body: { status: 'DUPLICATE', serverId: '1000004762' } },
      { status: 422, body: { status: 'REJECTED', reason: 'Ghana Card GHA-123456789-0 already belongs to Kofi Mensah (member 1000000007).' } },
      { status: 409, body: { message: 'different details' } },
    ];
    const { api } = make({ 'POST /v1/registrations': () => answers.shift()! });
    const out = await api.pushRegistrations(session, [payload(), payload(), payload()]);
    expect(out.map((r) => r.status)).toEqual(['DUPLICATE', 'REJECTED', 'CONFLICT']);
    expect(out[1].reason).toContain('already belongs to Kofi Mensah');
  });

  test('a server that is not ready leaves the registration waiting instead of refusing it', async () => {
    const { api } = make({ 'POST /v1/registrations': () => ({ status: 503, body: { message: 'not switched on' } }) });
    await expect(api.pushRegistrations(session, [payload()])).rejects.toMatchObject({ kind: 'SERVER' });
  });

  test('reads the member types and who already holds an ID', async () => {
    const { api, calls } = make({
      'GET /v1/member-types': () => ({
        status: 200,
        body: {
          items: [
            { code: 'IND', label: 'INDIVIDUAL', sharesOptional: false, guardianRequired: false },
            { code: 'KID', label: 'KIDDY SAVINGS', sharesOptional: true, guardianRequired: true },
            { label: 'no code' },
          ],
        },
      }),
      'POST /v1/members/check': () => ({
        status: 200,
        body: { conflicts: [{ label: 'Voter ID', value: 'AB1234567', memberCode: '1000000007', memberName: 'Kofi Mensah' }] },
      }),
    });
    expect(await api.memberTypes(session)).toEqual([
      { code: 'IND', label: 'INDIVIDUAL', sharesOptional: false, guardianRequired: false },
      { code: 'KID', label: 'KIDDY SAVINGS', sharesOptional: true, guardianRequired: true },
    ]);
    expect(await api.checkMember(session, { voterIdNo: 'AB1234567' })).toEqual([
      { label: 'Voter ID', value: 'AB1234567', memberCode: '1000000007', memberName: 'Kofi Mensah' },
    ]);
    expect(calls[1].body).toEqual({ voterIdNo: 'AB1234567' });
  });
});

describe('KYC pictures over HTTP', () => {
  const upload = { kind: 'signature', fileName: 'sig.jpg', dataBase64: 'AAAA' };

  test('are sent to the member and counted as saved', async () => {
    const { api, calls } = make({ 'POST /v1/members/1000004762/documents': () => ({ status: 200, body: { status: 'SAVED', kind: 'signature' } }) });
    expect(await api.uploadDocument(session, '1000004762', upload)).toEqual({ status: 'SAVED' });
    expect(calls[0].body).toEqual(upload);
  });

  test('a refusal carries the reason, and a member already approved is a conflict', async () => {
    const answers = [
      { status: 422, body: { status: 'REJECTED', reason: 'Signature must be a JPG, PNG or GIF picture.' } },
      { status: 409, body: { status: 'CONFLICT', reason: 'This member has already been approved.' } },
      { status: 404, body: { status: 'REJECTED', reason: 'That member was not found.' } },
    ];
    const { api } = make({ 'POST /v1/members/1000004762/documents': () => answers.shift()! });
    expect(await api.uploadDocument(session, '1000004762', upload)).toEqual({ status: 'REJECTED', reason: 'Signature must be a JPG, PNG or GIF picture.' });
    expect(await api.uploadDocument(session, '1000004762', upload)).toMatchObject({ status: 'CONFLICT' });
    expect(await api.uploadDocument(session, '1000004762', upload)).toMatchObject({ status: 'REJECTED', reason: 'That member was not found.' });
  });

  test('a server that is not ready leaves the picture waiting', async () => {
    const { api } = make({ 'POST /v1/members/1000004762/documents': () => ({ status: 503, body: { message: 'not on' } }) });
    await expect(api.uploadDocument(session, '1000004762', upload)).rejects.toMatchObject({ kind: 'SERVER' });
  });
});
