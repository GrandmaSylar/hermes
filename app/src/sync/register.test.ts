import { ApiError } from '@/data/api/contract';
import { MockApi } from '@/data/api/mock';
import type { RegistrationDraft } from '@/domain/registration';
import type { Session } from '@/domain/types';
import { createMemoryRepos } from '@/test/memory-repos';
import { signInToMock } from '@/test/sign-in';
import { syncOnce } from './engine';
import { registerMember } from './register';

let ids = 0;
const newId = () => `reg-${++ids}`;

const draft = (overrides: Partial<RegistrationDraft> = {}): RegistrationDraft => ({
  firstName: 'Ama',
  lastName: 'Mensah',
  gender: 'F',
  dateOfBirth: '1990-04-23',
  phone: '0241234567',
  idType: 'GHANA_CARD',
  idNumber: 'GHA-123456789-0',
  address: 'Kasoa',
  ...overrides,
});

async function setup(offline = { value: false }) {
  const api = new MockApi({ memberCount: 20, failNetwork: () => offline.value });
  const session: Session = await signInToMock(api);
  return { api, session, repos: createMemoryRepos(), offline };
}

describe('member registration', () => {
  test('is saved on the phone first, normalised, and waits to sync', async () => {
    const { session, repos } = await setup();
    const result = await registerMember(repos, session, draft({ phone: '+233 24 123 4567', idNumber: 'gha-123456789-0' }), newId);
    expect(result.ok).toBe(true);
    const [saved] = await repos.registrations.list(10);
    expect(saved).toMatchObject({ phone: '0241234567', idNumber: 'GHA-123456789-0', status: 'PENDING' });
  });

  test('an invalid form saves nothing and says which fields are wrong', async () => {
    const { session, repos } = await setup();
    const result = await registerMember(repos, session, draft({ phone: '123', firstName: '' }), newId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['firstName', 'phone']);
    expect(await repos.registrations.list(10)).toHaveLength(0);
  });

  test('the same ID number cannot be registered twice on one phone', async () => {
    const { session, repos } = await setup();
    await registerMember(repos, session, draft(), newId);
    const again = await registerMember(repos, session, draft({ firstName: 'Abena' }), newId);
    expect(again.ok).toBe(false);
    expect(await repos.registrations.list(10)).toHaveLength(1);
  });

  test('is delivered once and shown as waiting for approval with the office reference', async () => {
    const { api, session, repos } = await setup();
    await registerMember(repos, session, draft(), newId);
    const report = await syncOnce({ repos, api, session });
    expect(report).toMatchObject({ registrationsSent: 1, registrationsRejected: 0 });
    const [saved] = await repos.registrations.list(10);
    expect(saved.status).toBe('SYNCED');
    expect(saved.serverId).toMatch(/^MD-/);
  });

  test('offline: stays safe and is delivered when the network returns', async () => {
    const offline = { value: false };
    const { api, session, repos } = await setup(offline);
    offline.value = true;
    await registerMember(repos, session, draft(), newId);
    const down = await syncOnce({ repos, api, session });
    expect(down.offline).toBe(true);
    expect((await repos.registrations.list(10))[0].status).toBe('PENDING');
    offline.value = false;
    expect((await syncOnce({ repos, api, session })).registrationsSent).toBe(1);
  });

  test('a lost response then a retry cannot create a second draft', async () => {
    const { api, session, repos } = await setup();
    const saved = await registerMember(repos, session, draft(), newId);
    if (!saved.ok) throw new Error('save failed');
    const r = saved.item;
    const [first] = await api.pushRegistrations(session, [
      { ...r, gender: r.gender, localRegistrationId: r.localRegistrationId },
    ]);
    expect(first.status).toBe('ACCEPTED');
    const report = await syncOnce({ repos, api, session });
    expect(report.registrationsSent).toBe(1);
    expect((await repos.registrations.list(10))[0].serverId).toBe(first.serverId);
  });

  test('the office refusing a duplicate ID is shown with its reason and not retried', async () => {
    const { api, session, repos } = await setup();
    // Another phone already registered this person.
    await api.pushRegistrations(session, [
      {
        localRegistrationId: 'other-phone',
        firstName: 'Ama',
        lastName: 'Mensah',
        gender: 'F',
        dateOfBirth: '1990-04-23',
        phone: '0241234567',
        idType: 'GHANA_CARD',
        idNumber: 'GHA-123456789-0',
        address: 'Kasoa',
        capturedAt: new Date().toISOString(),
      },
    ]);
    await registerMember(repos, session, draft(), newId);
    const report = await syncOnce({ repos, api, session });
    expect(report.registrationsRejected).toBe(1);
    const [saved] = await repos.registrations.list(10);
    expect(saved.status).toBe('REJECTED');
    expect(saved.lastError).toMatch(/already registered/);
    expect(await repos.registrations.due(10)).toHaveLength(0);
    // A rejected registration frees the ID number, so it can be corrected and retried.
    expect(await repos.registrations.hasIdNumber('GHA-123456789-0')).toBe(false);
  });

  test('registration is blocked when too many items already wait to sync', async () => {
    const { session, repos } = await setup();
    const tight: Session = { ...session, limits: { ...session.limits, maxUnsyncedItems: 1 } };
    expect((await registerMember(repos, tight, draft(), newId)).ok).toBe(true);
    const second = await registerMember(repos, tight, draft({ idNumber: 'GHA-999999999-9' }), newId);
    expect(second.ok).toBe(false);
  });

  test('a session that is no longer valid keeps registrations waiting', async () => {
    const { session, repos } = await setup();
    await registerMember(repos, session, draft(), newId);
    const expired = new MockApi({ memberCount: 5 });
    expired.pushRegistrations = async () => {
      throw new ApiError('AUTH', 'Session expired.');
    };
    const report = await syncOnce({ repos, api: expired, session });
    expect(report.authError).toBe(true);
    expect(await repos.registrations.due(10)).toHaveLength(1);
  });
});
