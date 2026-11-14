import { ApiError } from '@/data/api/contract';
import { MOCK_OTP, MOCK_PASSWORD, MOCK_STAFF_ID, MockApi } from '@/data/api/mock';
import type { Session } from '@/domain/types';
import { createMemoryRepos } from '@/test/memory-repos';
import { captureCollection } from './capture';
import { syncOnce } from './engine';

let ids = 0;
const newId = () => `local-${++ids}`;

async function setup(options: { memberCount?: number; offline?: { value: boolean } } = {}) {
  const offline = options.offline ?? { value: false };
  const api = new MockApi({ memberCount: options.memberCount ?? 300, failNetwork: () => offline.value });
  const { challengeId } = await api.login(MOCK_STAFF_ID, MOCK_PASSWORD);
  const session: Session = await api.verifyOtp(challengeId, MOCK_OTP, 'device-1');
  const repos = createMemoryRepos();
  // Pull members first, as the app does on its first sync.
  await syncOnce({ repos, api, session });
  return { api, session, repos, offline };
}

const activeMember = async (repos: Awaited<ReturnType<typeof setup>>['repos']) => {
  const found = (await repos.members.search('', 300)).find((m) => m.status === 'ACTIVE');
  if (!found) throw new Error('no active member');
  return found;
};

describe('sync engine', () => {
  test('first sync downloads members, and does not repeat while the data is fresh', async () => {
    const { api, session, repos } = await setup({ memberCount: 2500 });
    expect(await repos.members.count()).toBe(2500);
    const again = await syncOnce({ repos, api, session });
    expect(again.pulledMembers).toBe(0);
  });

  test('a captured collection is delivered once and marked as pending approval', async () => {
    const { api, session, repos } = await setup();
    const member = await activeMember(repos);
    const saved = await captureCollection(repos, session, { member, productType: 'SAVINGS_DEPOSIT', amount: '40' }, newId);
    expect(saved.ok).toBe(true);

    const report = await syncOnce({ repos, api, session });
    expect(report).toMatchObject({ pushed: 1, accepted: 1, duplicates: 0, offline: false });
    const [item] = await repos.outbox.list(10);
    expect(item.status).toBe('SYNCED');
    expect(item.serverId).toMatch(/^FT-/);
    expect(item.amount).toBe('40.00');
  });

  test('offline: items stay safe and are delivered automatically once the network returns', async () => {
    const { api, session, repos, offline } = await setup();
    const member = await activeMember(repos);
    offline.value = true;
    await captureCollection(repos, session, { member, productType: 'SAVINGS_DEPOSIT', amount: '10' }, newId);
    await captureCollection(repos, session, { member, productType: 'SHARE_CONTRIBUTION', amount: '20' }, newId);

    const down = await syncOnce({ repos, api, session });
    expect(down.offline).toBe(true);
    expect((await repos.outbox.list(10)).every((i) => i.status === 'PENDING')).toBe(true);

    offline.value = false;
    const up = await syncOnce({ repos, api, session });
    expect(up.accepted).toBe(2);
    expect((await repos.outbox.list(10)).every((i) => i.status === 'SYNCED')).toBe(true);
  });

  test('retry after a lost response cannot create a second entry', async () => {
    const { api, session, repos } = await setup();
    const member = await activeMember(repos);
    const saved = await captureCollection(repos, session, { member, productType: 'SAVINGS_DEPOSIT', amount: '75' }, newId);
    if (!saved.ok) throw new Error('capture failed');

    // The server receives the item, but the phone never gets the answer.
    const [first] = await api.pushTransactions(session, [
      {
        localTransactionId: saved.item.localTransactionId,
        memberCode: saved.item.memberCode,
        productType: saved.item.productType,
        amount: saved.item.amount,
        reference: saved.item.reference,
        collectedAt: saved.item.collectedAt,
      },
    ]);
    expect(first.status).toBe('ACCEPTED');

    // The phone still thinks it is waiting, so it retries.
    const report = await syncOnce({ repos, api, session });
    expect(report).toMatchObject({ accepted: 0, duplicates: 1 });
    const [item] = await repos.outbox.list(10);
    expect(item.status).toBe('SYNCED');
    expect(item.serverId).toBe(first.serverId);
  });

  test('the same local id with different details is a conflict, never an overwrite', async () => {
    const { api, session, repos } = await setup();
    const member = await activeMember(repos);
    const saved = await captureCollection(repos, session, { member, productType: 'SAVINGS_DEPOSIT', amount: '30' }, () => 'fixed-id');
    expect(saved.ok).toBe(true);
    await syncOnce({ repos, api, session });

    // The same id comes back with a different amount.
    await repos.outbox.rows.delete('fixed-id');
    await repos.outbox.enqueue({
      localTransactionId: 'fixed-id',
      memberCode: member.memberCode,
      memberName: member.name,
      productType: 'SAVINGS_DEPOSIT',
      amount: '300.00',
      reference: null,
      collectedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    const report = await syncOnce({ repos, api, session });
    expect(report.conflicts).toBe(1);
    expect((await repos.outbox.list(10))[0].status).toBe('CONFLICT');
  });

  test('a business rejection is shown with its reason and not retried', async () => {
    const { api, session, repos } = await setup();
    const member = await activeMember(repos);
    // A loan repayment for a member with no loan is refused by the core system.
    const noLoan = (await repos.members.search('', 300)).find((m) => m.status === 'ACTIVE' && m.balances.loan === '0.00');
    expect(noLoan).toBeDefined();
    await captureCollection(repos, session, { member: noLoan ?? member, productType: 'LOAN_REPAYMENT', amount: '20' }, newId);
    const report = await syncOnce({ repos, api, session });
    expect(report.rejected).toBe(1);
    const [item] = await repos.outbox.list(10);
    expect(item.status).toBe('REJECTED');
    expect(item.lastError).toMatch(/no outstanding loan/i);
    expect((await repos.outbox.due(10)).length).toBe(0);
  });

  test('items left in SENDING by a crash are recovered and sent', async () => {
    const { api, session, repos } = await setup();
    const member = await activeMember(repos);
    const saved = await captureCollection(repos, session, { member, productType: 'SAVINGS_DEPOSIT', amount: '15' }, newId);
    if (!saved.ok) throw new Error('capture failed');
    await repos.outbox.markSending([saved.item.localTransactionId]);
    const report = await syncOnce({ repos, api, session });
    expect(report.accepted).toBe(1);
  });

  test('two syncs started together share one run', async () => {
    const { api, session, repos } = await setup();
    const member = await activeMember(repos);
    await captureCollection(repos, session, { member, productType: 'SAVINGS_DEPOSIT', amount: '12' }, newId);
    const [a, b] = await Promise.all([syncOnce({ repos, api, session }), syncOnce({ repos, api, session })]);
    expect(a).toBe(b);
    expect(a.accepted).toBe(1);
  });

  test('capture is blocked once too much cash is waiting to sync', async () => {
    const { session, repos } = await setup();
    const member = await activeMember(repos);
    const tight: Session = { ...session, limits: { ...session.limits, maxUnsyncedItems: 2 } };
    expect((await captureCollection(repos, tight, { member, productType: 'SAVINGS_DEPOSIT', amount: '1' }, newId)).ok).toBe(true);
    expect((await captureCollection(repos, tight, { member, productType: 'SAVINGS_DEPOSIT', amount: '1' }, newId)).ok).toBe(true);
    const third = await captureCollection(repos, tight, { member, productType: 'SAVINGS_DEPOSIT', amount: '1' }, newId);
    expect(third.ok).toBe(false);
  });

  test('a double tap with the same id saves one entry', async () => {
    const { session, repos } = await setup();
    const member = await activeMember(repos);
    await captureCollection(repos, session, { member, productType: 'SAVINGS_DEPOSIT', amount: '9' }, () => 'same');
    await captureCollection(repos, session, { member, productType: 'SAVINGS_DEPOSIT', amount: '9' }, () => 'same');
    expect((await repos.outbox.list(10)).length).toBe(1);
  });

  test('a session that is no longer valid is reported, and items stay waiting', async () => {
    const { session, repos } = await setup();
    const member = await activeMember(repos);
    await captureCollection(repos, session, { member, productType: 'SAVINGS_DEPOSIT', amount: '5' }, newId);
    const expired = new MockApi({ memberCount: 10 });
    expired.pushTransactions = async () => {
      throw new ApiError('AUTH', 'Session expired.');
    };
    const report = await syncOnce({ repos, api: expired, session });
    expect(report.authError).toBe(true);
    expect((await repos.outbox.due(10)).length).toBe(1);
  });
});
