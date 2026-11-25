import { ApiError } from '@/data/api/contract';
import { MockApi } from '@/data/api/mock';
import { DEFAULT_MEMBER_TYPES, EMPTY_FORM } from '@/domain/registration';
import type { Session } from '@/domain/types';
import { validForm } from '@/test/registration-form';
import { createMemoryRepos } from '@/test/memory-repos';
import { signInToMock } from '@/test/sign-in';
import { KV_MEMBER_TYPES, syncOnce } from './engine';
import { registerMember } from './register';

let ids = 0;
const newId = () => `reg-${++ids}`;
const types = DEFAULT_MEMBER_TYPES;
const NOW = new Date('2026-11-25T12:00:00.000Z');
const now = () => NOW;

async function setup(offline = { value: false }) {
  const api = new MockApi({ memberCount: 20, failNetwork: () => offline.value });
  const session: Session = await signInToMock(api);
  return { api, session, repos: createMemoryRepos(), offline };
}

describe('member registration', () => {
  test('is saved on the phone first, with the whole form, and waits to sync', async () => {
    const { session, repos } = await setup();
    const result = await registerMember(repos, session, validForm({ phone: '+233 24 412 3456' }), types, newId, now);
    expect(result.ok).toBe(true);
    const [saved] = await repos.registrations.list(10);
    expect(saved).toMatchObject({ firstName: 'Samuel', lastName: 'Akuffo', gender: 'M', idType: 'NATIONAL_ID', idNumber: 'GHA-123456789-0', status: 'PENDING' });
    expect(saved.payload).toMatchObject({ memberType: 'IND', nationalId: 'GHA-123456789-0', region: 'Central', beneficiaries: [{ name: 'Ama Akuffo', percentage: 100 }] });
  });

  test('an invalid form saves nothing and names the step and the fields that are wrong', async () => {
    const { session, repos } = await setup();
    const result = await registerMember(repos, session, validForm({ phone: '123', firstName: '' }), types, newId, now);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.step).toBe('personal');
      expect(result.problems.map((p) => p.field)).toEqual(['firstName']);
    }
    expect(await repos.registrations.list(10)).toHaveLength(0);
    const second = await registerMember(repos, session, validForm({ phone: '123' }), types, newId, now);
    if (!second.ok) expect(second.step).toBe('contact');
  });

  test('the same ID cannot be registered twice on one phone, whichever ID type it was', async () => {
    const { session, repos } = await setup();
    await registerMember(repos, session, validForm({ nationalId: '', voterIdNo: 'AB1234567' }), types, newId, now);
    const again = await registerMember(repos, session, validForm({ firstName: 'Abena', nationalId: '', voterIdNo: 'AB1234567' }), types, newId, now);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.problems[0].message).toContain('Voter ID Number AB1234567 is already in a registration saved on this phone');
    expect(await repos.registrations.list(10)).toHaveLength(1);
  });

  test('a guardian ID is not counted as the member\'s own', async () => {
    const { session, repos } = await setup();
    const child = validForm({
      memberType: 'KID',
      birthDate: '2018-03-01',
      nationalId: '',
      passportNo: 'G7654321',
      guardian: { ...EMPTY_FORM.guardian, name: 'Kofi Boateng', nationalId: 'GHA-555555555-5', phone: '0201234567' },
    });
    expect((await registerMember(repos, session, child, types, newId, now)).ok).toBe(true);
    // The guardian can now register themselves with the same Ghana Card.
    const guardian = validForm({ firstName: 'Kofi', lastName: 'Boateng', nationalId: 'GHA-555555555-5', phone: '0201234567' });
    expect((await registerMember(repos, session, guardian, types, newId, now)).ok).toBe(true);
  });

  test('is delivered once and shown as received with the new member number', async () => {
    const { api, session, repos } = await setup();
    await registerMember(repos, session, validForm(), types, newId, now);
    const report = await syncOnce({ repos, api, session });
    expect(report).toMatchObject({ registrationsSent: 1, registrationsRejected: 0 });
    const [sent] = await repos.registrations.list(10);
    expect(sent.status).toBe('SYNCED');
    expect(sent.serverId).toMatch(/^MD-/);
    // Nothing more to send the next time.
    expect((await syncOnce({ repos, api, session })).registrationsSent).toBe(0);
  });

  test('the office refusing a registration shows the reason', async () => {
    const { api, session, repos } = await setup();
    await registerMember(repos, session, validForm(), types, newId, now);
    await syncOnce({ repos, api, session });
    // The same ID again, from a second registration the phone could not have known about.
    await repos.registrations.applyResult('reg-' + ids, 'REJECTED', {});
    await registerMember(repos, session, validForm({ firstName: 'Abena' }), types, newId, now);
    const report = await syncOnce({ repos, api, session });
    expect(report.registrationsRejected).toBe(1);
    const rejected = (await repos.registrations.list(10)).find((r) => r.status === 'REJECTED' && r.lastError);
    expect(rejected?.lastError).toContain('already registered');
  });

  test('waits on the phone when there is no connection, then goes through', async () => {
    const offline = { value: false };
    const { api, session, repos } = await setup(offline);
    offline.value = true;
    await registerMember(repos, session, validForm(), types, newId, now);
    const down = await syncOnce({ repos, api, session });
    expect(down.offline).toBe(true);
    expect((await repos.registrations.list(10))[0].status).toBe('PENDING');
    offline.value = false;
    expect((await syncOnce({ repos, api, session })).registrationsSent).toBe(1);
  });

  test('a registration saved by an older version of the app is refused with a clear message, not sent half empty', async () => {
    const { api, session, repos } = await setup();
    await repos.registrations.enqueue({
      localRegistrationId: 'old-1',
      firstName: 'Ama',
      lastName: 'Mensah',
      gender: 'F',
      dateOfBirth: '1990-04-23',
      phone: '0241234567',
      idType: 'GHANA_CARD',
      idNumber: 'GHA-123456789-0',
      address: 'Kasoa',
      capturedAt: NOW.toISOString(),
      createdAt: NOW.toISOString(),
      payload: null,
    });
    const report = await syncOnce({ repos, api, session });
    expect(report.registrationsRejected).toBe(1);
    expect((await repos.registrations.list(10))[0].lastError).toContain('older version of the app');
  });

  test('the member types the server offers are kept for the form to use offline', async () => {
    const { api, session, repos } = await setup();
    await syncOnce({ repos, api, session });
    const stored = JSON.parse((await repos.kv.get(KV_MEMBER_TYPES)) ?? '[]');
    expect(stored.map((t: { code: string }) => t.code)).toEqual(['IND', 'YTH', 'KID', 'STD']);
  });

  test('a network failure while asking about member types does not fail the sync', async () => {
    const { api, session, repos } = await setup();
    api.memberTypes = async () => {
      throw new ApiError('NETWORK', 'down');
    };
    const report = await syncOnce({ repos, api, session });
    expect(report.offline).toBe(false);
  });
});
