import { validateCapture } from './capture';
import { computeDayMetrics } from './metrics';
import type { Member, MobilizerLimits, OutboxItem } from './types';

const limits: MobilizerLimits = { maxUnsyncedItems: 3, maxUnsyncedAmount: '1000.00', maxSingleAmount: '500.00' };

const savingsAccount = { id: 500001, number: '1-KS', productCode: 'KS', productName: 'Ordinary Savings', balance: '10.00' };
const sharesAccount = { id: 800001, number: '1-SH', productCode: 'SH', productName: 'Ordinary Shares', balance: '50.00' };

const member = (status: Member['status'] = 'ACTIVE'): Member => ({
  memberCode: '100001',
  name: 'Ama Mensah',
  phone: '0241234567',
  status,
  branchCode: '001',
  balances: { savings: '10.00', shares: '0.00', loan: '0.00' },
  asOf: '2026-11-14T00:00:00.000Z',
  savingsAccountId: 500001,
  accounts: { savings: [savingsAccount], shares: [sharesAccount] },
  myCustomer: false,
  collectCount: 0,
});

const none = { count: 0, amountMinor: 0n };
const check = (amount: string, unsynced = none, m = member()) =>
  validateCapture({ member: m, productType: 'SAVINGS_DEPOSIT', amount, account: savingsAccount }, unsynced, limits);

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
  test('a deposit needs a chosen account of the right type', () => {
    const m = member();
    const run = (productType: 'SAVINGS_DEPOSIT' | 'SHARE_CONTRIBUTION', account: typeof savingsAccount | null | undefined) =>
      validateCapture({ member: m, productType, amount: '10', account }, none, limits);
    expect(run('SAVINGS_DEPOSIT', undefined)).toMatch(/Choose the account/);
    expect(run('SAVINGS_DEPOSIT', null)).toMatch(/Choose the account/);
    expect(run('SAVINGS_DEPOSIT', savingsAccount)).toBeNull();
    expect(run('SHARE_CONTRIBUTION', sharesAccount)).toBeNull();
    // A share holding cannot receive a savings deposit, nor the other way round.
    expect(run('SAVINGS_DEPOSIT', sharesAccount)).toMatch(/does not belong/);
    expect(run('SHARE_CONTRIBUTION', savingsAccount)).toMatch(/does not belong/);
    // An account of another member is refused too.
    expect(run('SAVINGS_DEPOSIT', { ...savingsAccount, id: 999 })).toMatch(/does not belong/);
  });
  test('a member with no account of the type cannot be given a deposit of that type', () => {
    const noShares = { ...member(), accounts: { savings: [savingsAccount], shares: [] } };
    expect(validateCapture({ member: noShares, productType: 'SHARE_CONTRIBUTION', amount: '10', account: sharesAccount }, none, limits)).toMatch(
      /no shares account/,
    );
    const noSavings = { ...member(), accounts: { savings: [], shares: [sharesAccount] } };
    expect(check('10', none, noSavings)).toMatch(/no savings account/);
  });
  test('amount limits apply to shares deposits too', () => {
    const run = (amount: string, unsynced = none) =>
      validateCapture({ member: member(), productType: 'SHARE_CONTRIBUTION', amount, account: sharesAccount }, unsynced, limits);
    expect(run('500.00')).toBeNull();
    expect(run('500.01')).toMatch(/cannot exceed/);
    expect(run('100', { count: 3, amountMinor: 0n })).toMatch(/Too many items/);
    expect(run('100.01', { count: 1, amountMinor: 90000n })).toMatch(/exceed your limit/);
  });
  test('Mobile Money is refused unless this build offers it', () => {
    const base = { member: member(), productType: 'SAVINGS_DEPOSIT' as const, amount: '10', account: savingsAccount };
    expect(validateCapture({ ...base, paymentMode: 'CASH' }, none, limits)).toBeNull();
    expect(validateCapture({ ...base, paymentMode: 'MOBILE_MONEY' }, none, limits)).toMatch(/not available/);
    expect(validateCapture({ ...base, paymentMode: 'MOBILE_MONEY', allowedPaymentModes: ['CASH', 'MOBILE_MONEY'] }, none, limits)).toBeNull();
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
    accountLabel: null,
    paymentMode: 'CASH',
    officeStatus: null,
    officeReason: null,
    officeDecidedAt: null,
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
