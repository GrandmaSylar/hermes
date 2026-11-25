import { ApiError, type OfficeDecision } from '@/data/api/contract';
import { MockApi } from '@/data/api/mock';
import type { Session } from '@/domain/types';
import { createMemoryRepos } from '@/test/memory-repos';
import { signInToMock } from '@/test/sign-in';
import { captureCollection } from './capture';
import { syncOnce } from './engine';

let ids = 0;
const newId = () => `local-d-${++ids}`;

/** The mock server, but with the office's decisions under the test's control. */
async function setup() {
  const api = new MockApi({ memberCount: 50 });
  const asked: (string | null)[] = [];
  let decisions: OfficeDecision[] = [];
  let failNext: Error | null = null;
  api.pullDecisions = async (_session: Session, since: string | null) => {
    asked.push(since);
    if (failNext) {
      const error = failNext;
      failNext = null;
      throw error;
    }
    return decisions;
  };
  const session = await signInToMock(api);
  const repos = createMemoryRepos();
  await syncOnce({ repos, api, session });
  const member = (await repos.members.search('', 50)).find((m) => m.status === 'ACTIVE')!;
  const collect = async (amount: string) => {
    const saved = await captureCollection(repos, session, { member, productType: 'SAVINGS_DEPOSIT', amount, account: member.accounts.savings[0] }, newId);
    if (!saved.ok) throw new Error('capture failed');
    return saved.item.localTransactionId;
  };
  return {
    api,
    session,
    repos,
    collect,
    asked,
    decide: (next: OfficeDecision[]) => {
      decisions = next;
    },
    failWith: (error: Error) => {
      failNext = error;
    },
  };
}

const decision = (localTransactionId: string, status: OfficeDecision['status'], reason: string | null = null): OfficeDecision => ({
  localTransactionId,
  status,
  decidedAt: '2026-11-25T15:00:00.000Z',
  reason,
});

describe('office decisions', () => {
  test('a delivered collection shows what the office decided', async () => {
    const { api, session, repos, collect, decide } = await setup();
    const id = await collect('40');
    decide([decision(id, 'APPROVED')]);

    const report = await syncOnce({ repos, api, session });
    expect(report.decisionsUpdated).toBe(1);
    const [item] = await repos.outbox.list(5);
    expect(item).toMatchObject({ status: 'SYNCED', officeStatus: 'APPROVED', officeDecidedAt: '2026-11-25T15:00:00.000Z' });
  });

  test('a refusal keeps the office\'s reason', async () => {
    const { api, session, repos, collect, decide } = await setup();
    const id = await collect('40');
    decide([decision(id, 'REJECTED', 'Amount does not match the receipt.')]);

    await syncOnce({ repos, api, session });
    const [item] = await repos.outbox.list(5);
    expect(item.officeStatus).toBe('REJECTED');
    expect(item.officeReason).toBe('Amount does not match the receipt.');
  });

  test('a decision never touches something still waiting on the phone, or unknown to it', async () => {
    const { api, session, repos, collect, decide, asked } = await setup();
    const sent = await collect('10');
    await syncOnce({ repos, api, session });
    // Captured afterwards and not yet delivered when the decision arrives.
    const waiting = await collect('20');
    decide([decision(waiting, 'APPROVED'), decision('not-on-this-phone', 'APPROVED'), decision(sent, 'PENDING')]);
    // Delivery of `waiting` happens in the same sync, so make it fail to leave it waiting.
    const original = api.pushTransactions.bind(api);
    api.pushTransactions = async () => [];
    const report = await syncOnce({ repos, api, session });
    api.pushTransactions = original;

    expect(asked.length).toBeGreaterThan(0);
    const byId = new Map((await repos.outbox.list(10)).map((i) => [i.localTransactionId, i]));
    expect(byId.get(waiting)!.officeStatus).toBeNull();
    expect(byId.get(sent)!.officeStatus).toBe('PENDING');
    expect(report.decisionsUpdated).toBe(1);
  });

  test('nothing is asked once every collection has its final answer', async () => {
    const { api, session, repos, collect, decide, asked } = await setup();
    const a = await collect('10');
    const b = await collect('20');
    decide([decision(a, 'VERIFIED'), decision(b, 'REJECTED', 'No such member.')]);
    await syncOnce({ repos, api, session });
    const callsAfterFirst = asked.length;
    expect(callsAfterFirst).toBe(1);

    expect(await repos.outbox.awaitingDecision()).toBe(0);
    await syncOnce({ repos, api, session });
    expect(asked.length).toBe(callsAfterFirst);
  });

  test('an approved collection is checked again until the supervisor verifies it', async () => {
    const { api, session, repos, collect, decide, asked } = await setup();
    const id = await collect('10');
    decide([decision(id, 'APPROVED')]);
    await syncOnce({ repos, api, session });
    expect(await repos.outbox.awaitingDecision()).toBe(1);
    decide([decision(id, 'VERIFIED')]);
    const report = await syncOnce({ repos, api, session });
    expect(report.decisionsUpdated).toBe(1);
    expect((await repos.outbox.list(1))[0].officeStatus).toBe('VERIFIED');
    expect(asked).toHaveLength(2);
  });

  test('the second check only asks for what changed since the first', async () => {
    const { api, session, repos, collect, decide, asked } = await setup();
    const id = await collect('10');
    decide([decision(id, 'PENDING')]);
    await syncOnce({ repos, api, session });
    await syncOnce({ repos, api, session });
    expect(asked[0]).toBeNull();
    expect(asked[1]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('losing the network while asking leaves everything as it was, to try again', async () => {
    const { api, session, repos, collect, failWith } = await setup();
    await collect('10');
    failWith(new ApiError('NETWORK', 'No connection to the server.'));
    const report = await syncOnce({ repos, api, session });
    expect(report.offline).toBe(true);
    const [item] = await repos.outbox.list(5);
    expect(item.status).toBe('SYNCED');
    expect(item.officeStatus).toBeNull();
  });

  test('a server that cannot report decisions is simply not asked', async () => {
    const { api, session, repos, collect, asked } = await setup();
    await collect('10');
    (api.capabilities as { officeDecisions: boolean }).officeDecisions = false;
    await syncOnce({ repos, api, session });
    expect(asked).toHaveLength(0);
  });
});
