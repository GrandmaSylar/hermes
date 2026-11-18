import { validateCapture } from './capture';
import { computeDayMetrics } from './metrics';
import type { Member, MobilizerLimits, OutboxItem } from './types';

const limits: MobilizerLimits = { maxUnsyncedItems: 3, maxUnsyncedAmount: '1000.00', maxSingleAmount: '500.00' };

const member = (status: Member['status'] = 'ACTIVE'): Member => ({
  memberCode: '100001',
  name: 'Ama Mensah',
  phone: '0241234567',
  status,
  branchCode: '001',
  balances: { savings: '10.00', shares: '0.00', loan: '0.00' },
  asOf: '2026-11-14T00:00:00.000Z',
  savingsAccountId: 500001,
  myCustomer: false,
  collectCount: 0,
});

const none = { count: 0, amountMinor: 0n };
const check = (amount: string, unsynced = none, m = member()) =>
  validateCapture({ member: m, productType: 'SAVINGS_DEPOSIT', amount }, unsynced, limits);

describe('validateCapture', () => {
  test('accepts a normal amount', () => {
    expect(check('100.50')).toBeNull();
  });
  test('rejects empty, malformed, zero and negative amounts', () => {
    expect(check('')).toMatch(/Enter the amount/);
    expect(check('12.345')).toMatch(/valid amount/);
    expect(check('-5')).toMatch(/valid amount/);
    expect(check('0')).toMatch(/greater than zero/);
  });
  test('rejects a single collection above the limit', () => {
    expect(check('500.01')).toMatch(/cannot exceed/);
    expect(check('500.00')).toBeNull();
  });
  test('stops capture when too many items wait to sync', () => {
    expect(check('10', { count: 3, amountMinor: 0n })).toMatch(/Too many items/);
  });
  test('stops capture when unsynced cash would exceed the ceiling', () => {
    // Ceiling is 1000.00. Exactly at the ceiling is allowed; one pesewa over is not.
    expect(check('100', { count: 1, amountMinor: 90000n })).toBeNull();
    expect(check('100', { count: 1, amountMinor: 90001n })).toMatch(/exceed your limit/);
    expect(check('100.01', { count: 1, amountMinor: 90000n })).toMatch(/exceed your limit/);
  });
  test('a savings deposit needs the savings account id from the core system', () => {
    const noAccount = { ...member(), savingsAccountId: null };
    expect(check('10', none, noAccount)).toMatch(/no savings account/);
    // Other products do not use it.
    expect(
      validateCapture({ member: noAccount, productType: 'SHARE_CONTRIBUTION', amount: '10' }, none, limits),
    ).toBeNull();
  });
  test('refuses inactive and pending members', () => {
    expect(check('10', none, member('INACTIVE'))).toMatch(/not active/);
    expect(check('10', none, member('PENDING_APPROVAL'))).toMatch(/not active/);
  });
});

describe('computeDayMetrics', () => {
  const item = (amount: string, status: OutboxItem['status']): OutboxItem => ({
    localTransactionId: Math.random().toString(),
    memberCode: '100001',
    memberName: 'Ama Mensah',
    productType: 'SAVINGS_DEPOSIT',
    amount,
    reference: null,
    collectedAt: '2026-11-14T08:00:00.000Z',
    status,
    attempts: 0,
    lastError: null,
    serverId: null,
    createdAt: '2026-11-14T08:00:00.000Z',
    accountId: 500001,
  });

  test('credits are everything received, debits are rejected items, net is the difference', () => {
    const m = computeDayMetrics([
      item('100.00', 'PENDING'),
      item('50.00', 'SYNCED'),
      item('25.50', 'REJECTED'),
      item('10.00', 'CONFLICT'),
    ]);
    expect(m.credits).toBe('185.50');
    expect(m.debits).toBe('35.50');
    expect(m.net).toBe('150.00');
    expect(m).toMatchObject({ count: 4, pending: 1, synced: 1, rejected: 2 });
  });

  test('an empty day is all zeros', () => {
    expect(computeDayMetrics([])).toMatchObject({ credits: '0.00', debits: '0.00', net: '0.00', count: 0 });
  });
});
