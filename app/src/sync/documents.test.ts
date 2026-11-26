import { ApiError } from '@/data/api/contract';
import { MockApi } from '@/data/api/mock';
import type { KycFile, KycKind } from '@/domain/registration';
import { DEFAULT_MEMBER_TYPES } from '@/domain/registration';
import type { Session } from '@/domain/types';
import { createFakeFiles } from '@/test/fake-files';
import { createMemoryRepos } from '@/test/memory-repos';
import { validForm } from '@/test/registration-form';
import { signInToMock } from '@/test/sign-in';
import { syncOnce } from './engine';
import { registerMember } from './register';

/** KYC pictures: kept on the phone with the registration, sent once the member has a number, then deleted. */

let ids = 0;
const newId = () => `reg-${++ids}`;
const NOW = new Date('2026-11-25T12:00:00.000Z');

const picked = (kind: KycKind, mimeType = 'image/jpeg', size = 120_000): KycFile => ({ kind, uri: `cache://${kind}`, name: `${kind}.jpg`, mimeType, size });

async function setup(offline = { value: false }) {
  const api = new MockApi({ memberCount: 20, failNetwork: () => offline.value });
  const session: Session = await signInToMock(api);
  const fake = createFakeFiles({ 'cache://passportPhoto': 'PHOTO', 'cache://signature': 'SIGN', 'cache://idBack': 'BACK' });
  return { api, session, repos: createMemoryRepos(), fake, offline };
}

const form = (kinds: KycKind[] = ['passportPhoto', 'signature']) =>
  validForm({ authorizationPreference: 'BOTH', documents: Object.fromEntries(kinds.map((k) => [k, picked(k)])) });

describe('KYC pictures with a registration', () => {
  test('are copied into the app\'s own storage when the registration is saved', async () => {
    const { session, repos, fake } = await setup();
    const result = await registerMember(repos, session, form(), DEFAULT_MEMBER_TYPES, newId, () => NOW, fake.store);
    expect(result.ok).toBe(true);
    const [saved] = await repos.registrations.list(10);
    expect(saved.payload).toMatchObject({ authorizationPreference: 'BOTH' });
    expect(saved.payload).not.toHaveProperty('documents');
    expect(saved.files.map((f) => [f.kind, f.status, f.uri.startsWith('kept://')])).toEqual([
      ['passportPhoto', 'PENDING', true],
      ['signature', 'PENDING', true],
    ]);
  });

  test('a registration with none still works, and one with pictures needs somewhere to keep them', async () => {
    const { session, repos } = await setup();
    expect((await registerMember(repos, session, validForm(), DEFAULT_MEMBER_TYPES, newId, () => NOW)).ok).toBe(true);
    const refused = await registerMember(repos, session, validForm({ firstName: 'Abena', nationalId: 'GHA-222222222-2', documents: { signature: picked('signature') } }), DEFAULT_MEMBER_TYPES, newId, () => NOW);
    expect(refused.ok).toBe(false);
  });

  test('a picture that is too large or the wrong type stops the step', async () => {
    const { session, repos, fake } = await setup();
    const big = await registerMember(repos, session, validForm({ documents: { idFront: picked('idFront', 'image/jpeg', 6 * 1024 * 1024) } }), DEFAULT_MEMBER_TYPES, newId, () => NOW, fake.store);
    expect(big).toMatchObject({ ok: false, step: 'documents' });
    const pdfPhoto = await registerMember(repos, session, validForm({ documents: { passportPhoto: picked('passportPhoto', 'application/pdf') } }), DEFAULT_MEMBER_TYPES, newId, () => NOW, fake.store);
    expect(pdfPhoto).toMatchObject({ ok: false, step: 'documents' });
    const pdfId = await registerMember(repos, session, validForm({ documents: { idFront: picked('idFront', 'application/pdf') } }), DEFAULT_MEMBER_TYPES, newId, () => NOW, fake.store);
    expect(pdfId.ok).toBe(true);
  });

  test('if saving a picture fails nothing is saved and the pictures already copied are removed', async () => {
    const { session, repos, fake } = await setup();
    const failing = { ...fake.store, keep: async (...args: Parameters<typeof fake.store.keep>) => (args[2] === 'signature' ? Promise.reject(new Error('disk full')) : fake.store.keep(...args)) };
    const result = await registerMember(repos, session, form(), DEFAULT_MEMBER_TYPES, newId, () => NOW, failing);
    expect(result).toMatchObject({ ok: false });
    expect(await repos.registrations.list(10)).toHaveLength(0);
    expect(fake.removed).toHaveLength(1);
  });
});

describe('sending KYC pictures', () => {
  test('go after the registration is received, then are deleted from the phone', async () => {
    const { api, session, repos, fake } = await setup();
    await registerMember(repos, session, form(), DEFAULT_MEMBER_TYPES, newId, () => NOW, fake.store);
    const report = await syncOnce({ repos, api, session, files: fake.store });
    expect(report).toMatchObject({ registrationsSent: 1, documentsSent: 2, documentsRejected: 0 });
    const [saved] = await repos.registrations.list(10);
    expect(saved.files.map((f) => f.status)).toEqual(['SENT', 'SENT']);
    expect([...api.documents.keys()].sort()).toEqual([`${saved.serverId}:passportPhoto`, `${saved.serverId}:signature`]);
    expect([...fake.contents.keys()].filter((k) => k.startsWith('kept://'))).toEqual([]);
    expect(fake.removed).toHaveLength(2);
    // Nothing more to send the next time.
    expect((await syncOnce({ repos, api, session, files: fake.store })).documentsSent).toBe(0);
  });

  test('wait while the phone is offline and are sent when it is back', async () => {
    const offline = { value: false };
    const { api, session, repos, fake } = await setup(offline);
    await registerMember(repos, session, form(), DEFAULT_MEMBER_TYPES, newId, () => NOW, fake.store);
    await syncOnce({ repos, api, session, files: fake.store });
    // A second registration whose pictures cannot go yet.
    await registerMember(repos, session, validForm({ firstName: 'Abena', nationalId: 'GHA-333333333-3', documents: { signature: picked('signature') } }), DEFAULT_MEMBER_TYPES, newId, () => NOW, fake.store);
    offline.value = true;
    const down = await syncOnce({ repos, api, session, files: fake.store });
    expect(down.offline).toBe(true);
    const waiting = (await repos.registrations.list(10)).find((r) => r.firstName === 'Abena')!;
    expect(waiting.files[0].status).toBe('PENDING');
    offline.value = false;
    expect((await syncOnce({ repos, api, session, files: fake.store })).documentsSent).toBe(1);
  });

  test('a network failure in the middle keeps the rest waiting and loses nothing', async () => {
    const { api, session, repos, fake } = await setup();
    await registerMember(repos, session, form(), DEFAULT_MEMBER_TYPES, newId, () => NOW, fake.store);
    const real = api.uploadDocument.bind(api);
    let calls = 0;
    api.uploadDocument = async (...args) => {
      calls += 1;
      if (calls === 2) throw new ApiError('NETWORK', 'down');
      return real(...args);
    };
    const report = await syncOnce({ repos, api, session, files: fake.store });
    expect(report).toMatchObject({ offline: true, documentsSent: 1 });
    const [saved] = await repos.registrations.list(10);
    expect(saved.files.map((f) => f.status)).toEqual(['SENT', 'PENDING']);
    api.uploadDocument = real;
    expect((await syncOnce({ repos, api, session, files: fake.store })).documentsSent).toBe(1);
  });

  test('a picture the server refuses shows the reason and is deleted', async () => {
    const { api, session, repos, fake } = await setup();
    await registerMember(repos, session, form(['signature']), DEFAULT_MEMBER_TYPES, newId, () => NOW, fake.store);
    api.uploadDocument = async () => ({ status: 'REJECTED', reason: 'Signature must be a JPG, PNG or GIF picture.' });
    const report = await syncOnce({ repos, api, session, files: fake.store });
    expect(report.documentsRejected).toBe(1);
    const [saved] = await repos.registrations.list(10);
    expect(saved.files[0]).toMatchObject({ status: 'REJECTED', lastError: 'Signature must be a JPG, PNG or GIF picture.' });
    expect(fake.removed).toHaveLength(1);
  });

  test('a picture that has gone from the phone is marked, not retried forever', async () => {
    const { api, session, repos, fake } = await setup();
    await registerMember(repos, session, form(['signature']), DEFAULT_MEMBER_TYPES, newId, () => NOW, fake.store);
    fake.contents.delete([...fake.contents.keys()].find((k) => k.startsWith('kept://'))!);
    const report = await syncOnce({ repos, api, session, files: fake.store });
    expect(report.documentsRejected).toBe(1);
    expect((await repos.registrations.list(10))[0].files[0].lastError).toContain('no longer on this phone');
  });

  test('are not sent while the server cannot take them, and wait on the phone', async () => {
    const { api, session, repos, fake } = await setup();
    api.capabilities.documents = false;
    await registerMember(repos, session, form(), DEFAULT_MEMBER_TYPES, newId, () => NOW, fake.store);
    const report = await syncOnce({ repos, api, session, files: fake.store });
    expect(report).toMatchObject({ registrationsSent: 1, documentsSent: 0 });
    expect((await repos.registrations.list(10))[0].files.map((f) => f.status)).toEqual(['PENDING', 'PENDING']);
  });

  test('of a registration the office refuses are deleted, not kept', async () => {
    const { api, session, repos, fake } = await setup();
    await registerMember(repos, session, form(['signature']), DEFAULT_MEMBER_TYPES, newId, () => NOW, fake.store);
    api.pushRegistrations = async (_s, items) => items.map((i) => ({ localRegistrationId: i.localRegistrationId, status: 'REJECTED' as const, reason: 'Ghana Card already belongs to someone.' }));
    const report = await syncOnce({ repos, api, session, files: fake.store });
    expect(report).toMatchObject({ registrationsRejected: 1, documentsSent: 0 });
    const [saved] = await repos.registrations.list(10);
    expect(saved.files[0].status).toBe('REJECTED');
    expect(fake.removed).toHaveLength(1);
  });
});
