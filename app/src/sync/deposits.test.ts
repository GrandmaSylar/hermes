import type { PushItem } from '@/data/api/contract';
import { MockApi } from '@/data/api/mock';
import { createMemoryRepos } from '@/test/memory-repos';
import { signInToMock } from '@/test/sign-in';
import { captureCollection } from './capture';
import { syncOnce } from './engine';

let ids = 0;
const newId = () => `dep-${++ids}`;

async function setup() {
  const api = new MockApi({ memberCount: 300 });
  const session = await signInToMock(api);
  const repos = createMemoryRepos();
  await syncOnce({ repos, api, session });
  return { api, session, repos };
}

/** A member with two savings accounts and a share holding, as the demo data gives every fourth member. */
async function richMember(repos: Awaited<ReturnType<typeof setup>>['repos']) {
  const found = (await repos.members.search('', 300)).find(
    (m) => m.status === 'ACTIVE' && m.accounts.savings.length === 2 && m.accounts.shares.length >= 1,
  );
  if (!found) throw new Error('no member with two savings accounts and shares');
  return found;
}

/** Records what the api is asked to deliver. */
function spy(api: MockApi) {
  const sent: PushItem[] = [];
  const original = api.pushTransactions.bind(api);
  api.pushTransactions = async (session, items) => {
    sent.push(...items);
    return original(session, items);
  };
  return sent;
}

describe('deposits to chosen accounts', () => {
  test('a savings deposit and a shares deposit are delivered with the right kind and the chosen account', async () => {
    const { api, session, repos } = await setup();
    const member = await richMember(repos);
    const second = member.accounts.savings[1];
    const holding = member.accounts.shares[0];
    const sent = spy(api);

    const a = await captureCollection(repos, session, { member, productType: 'SAVINGS_DEPOSIT', amount: '12.50', account: second }, () => 'dep-savings');
    const b = await captureCollection(repos, session, { member, productType: 'SHARE_CONTRIBUTION', amount: '30', account: holding }, () => 'dep-shares');
    expect(a.ok && b.ok).toBe(true);

    const report = await syncOnce({ repos, api, session });
    expect(report).toMatchObject({ pushed: 2, accepted: 2, rejected: 0 });
    expect(sent).toMatchObject([
      { localTransactionId: 'dep-savings', kind: 'SAVINGS', accountId: second.id, paymentMode: 'CASH', productType: 'SAVINGS_DEPOSIT' },
      { localTransactionId: 'dep-shares', kind: 'SHARES', accountId: holding.id, paymentMode: 'CASH', productType: 'SHARE_CONTRIBUTION' },
    ]);
    expect((await repos.outbox.list(10)).every((i) => i.status === 'SYNCED')).toBe(true);
  });

  test('the chosen account is stored with its label, not the member\'s default account', async () => {
    const { session, repos } = await setup();
    const member = await richMember(repos);
    const second = member.accounts.savings[1];
    const saved = await captureCollection(repos, session, { member, productType: 'SAVINGS_DEPOSIT', amount: '1', account: second }, newId);
    if (!saved.ok) throw new Error('capture failed');
    expect(saved.item.accountId).toBe(second.id);
    expect(saved.item.accountId).not.toBe(member.savingsAccountId);
    expect(saved.item.accountLabel).toBe(`Susu Savings · ${second.number}`);
    expect(saved.item.paymentMode).toBe('CASH');
  });

  test('nothing is saved without an account, or with an account of the wrong type', async () => {
    const { session, repos } = await setup();
    const member = await richMember(repos);
    const none = await captureCollection(repos, session, { member, productType: 'SHARE_CONTRIBUTION', amount: '5' }, newId);
    expect(none).toMatchObject({ ok: false, error: expect.stringMatching(/Choose the account/) });
    const wrong = await captureCollection(repos, session, { member, productType: 'SHARE_CONTRIBUTION', amount: '5', account: member.accounts.savings[0] }, newId);
    expect(wrong.ok).toBe(false);
    expect(await repos.outbox.list(10)).toHaveLength(0);
  });

  test('Mobile Money cannot be saved while it is switched off, and can once the build allows it', async () => {
    const { api, session, repos } = await setup();
    expect(api.capabilities.mobileMoney).toBe(false);
    const member = await richMember(repos);
    const input = { member, productType: 'SAVINGS_DEPOSIT' as const, amount: '5', account: member.accounts.savings[0], paymentMode: 'MOBILE_MONEY' as const };
    expect(await captureCollection(repos, session, input, newId)).toMatchObject({ ok: false, error: expect.stringMatching(/not available/) });
    const allowed = await captureCollection(repos, session, { ...input, allowedPaymentModes: ['CASH', 'MOBILE_MONEY'] }, newId);
    expect(allowed.ok && allowed.item.paymentMode).toBe('MOBILE_MONEY');
  });

  test('the demo server refuses a wrong-type account and Mobile Money', async () => {
    const { api, session, repos } = await setup();
    const member = await richMember(repos);
    const base: PushItem = {
      localTransactionId: 'x',
      memberCode: member.memberCode,
      productType: 'SAVINGS_DEPOSIT',
      kind: 'SAVINGS',
      amount: '1.00',
      reference: null,
      collectedAt: new Date().toISOString(),
      accountId: member.accounts.savings[0].id,
      paymentMode: 'CASH',
    };
    const results = await api.pushTransactions(session, [
      base,
      { ...base, localTransactionId: 'y', accountId: member.accounts.shares[0].id },
      { ...base, localTransactionId: 'z', paymentMode: 'MOBILE_MONEY' },
    ]);
    expect(results.map((r) => r.status)).toEqual(['ACCEPTED', 'REJECTED', 'REJECTED']);
  });

  test('a member refresh replaces the accounts a deposit can go to', async () => {
    const { api, session, repos } = await setup();
    const member = await richMember(repos);
    const closed = member.accounts.savings[1];
    const page = await api.pullMembers(session, null);
    const server = page.items.find((m) => m.memberCode === member.memberCode)!;
    await repos.members.upsertMany([{ ...server, accounts: { ...server.accounts, savings: [server.accounts.savings[0]] } }]);
    const after = await repos.members.get(member.memberCode);
    expect(after?.accounts.savings.map((a) => a.id)).toEqual([member.accounts.savings[0].id]);
    expect(after?.accounts.savings.map((a) => a.id)).not.toContain(closed.id);
  });
});

describe('capabilities', () => {
  test('Mobile Money is off by default, and the demo can switch it on', () => {
    expect(new MockApi({ memberCount: 1 }).capabilities.mobileMoney).toBe(false);
    expect(new MockApi({ memberCount: 1, mobileMoney: true }).capabilities.mobileMoney).toBe(true);
  });
});
