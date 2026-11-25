import {
  accountLabel,
  accountsFor,
  availablePaymentModes,
  buildDepositSummary,
  depositTitle,
  depositUnavailableReason,
  expectedBalance,
  findAccount,
  kindForProduct,
  parseDepositType,
  preselectedAccountId,
  sumBalances,
  typeForProduct,
} from './deposit';
import { PRODUCT_LABELS, type AccountOption, type Member } from './types';

const ks: AccountOption = { id: 1, number: '1-KS', productCode: 'KS', productName: 'Ordinary Savings', balance: '120.50' };
const su: AccountOption = { id: 2, number: '1-SU', productCode: 'SU', productName: 'Susu Savings', balance: '8.00' };
const sh: AccountOption = { id: 9, number: '1-SH', productCode: 'SH', productName: 'Ordinary Shares', balance: '300.00' };

const member = (over: Partial<Pick<Member, 'status' | 'accounts'>> = {}) => ({
  name: 'Ama Mensah',
  memberCode: '100001',
  status: 'ACTIVE' as Member['status'],
  accounts: { savings: [ks, su], shares: [sh] },
  ...over,
});

describe('expectedBalance', () => {
  test('adds the amount to the current balance', () => {
    expect(expectedBalance(ks, '10')).toBe('130.50');
    expect(expectedBalance(ks, '0.01')).toBe('120.51');
    expect(expectedBalance(ks, ' 5.5 ')).toBe('126.00');
  });

  test('cents never drift the way floats do', () => {
    // 0.1 + 0.2 in floating point is 0.30000000000000004.
    expect(expectedBalance({ balance: '0.10' }, '0.20')).toBe('0.30');
    expect(expectedBalance({ balance: '1.15' }, '2.20')).toBe('3.35');
    expect(expectedBalance({ balance: '0.99' }, '0.01')).toBe('1.00');
    expect(expectedBalance({ balance: '999.99' }, '0.01')).toBe('1000.00');
  });

  test('large numbers stay exact', () => {
    expect(expectedBalance({ balance: '999999999999.99' }, '0.01')).toBe('1000000000000.00');
    expect(expectedBalance({ balance: '900719925474.01' }, '0.99')).toBe('900719925475.00');
    expect(expectedBalance({ balance: '123456789012.34' }, '999999999999.99')).toBe('1123456789012.33');
  });

  test('an overdrawn balance is handled', () => {
    expect(expectedBalance({ balance: '-5.00' }, '2.50')).toBe('-2.50');
    expect(expectedBalance({ balance: '-5.00' }, '5.00')).toBe('0.00');
    expect(expectedBalance({ balance: '-0.50' }, '1.00')).toBe('0.50');
  });

  test('is null until the account and amount are both valid', () => {
    expect(expectedBalance(null, '10')).toBeNull();
    expect(expectedBalance(ks, '')).toBeNull();
    expect(expectedBalance(ks, '0')).toBeNull();
    expect(expectedBalance(ks, '0.00')).toBeNull();
    expect(expectedBalance(ks, '-5')).toBeNull();
    expect(expectedBalance(ks, '1.234')).toBeNull();
    expect(expectedBalance(ks, 'abc')).toBeNull();
    expect(expectedBalance(ks, '1e3')).toBeNull();
    expect(expectedBalance({ balance: 'n/a' }, '10')).toBeNull();
    // Beyond the 12 whole digits the app handles anywhere, it shows nothing rather than guess.
    expect(expectedBalance({ balance: '1000000000000.00' }, '1')).toBeNull();
  });
});

describe('account selection', () => {
  test('only this type\'s accounts are listed', () => {
    expect(accountsFor(member(), 'savings')).toEqual([ks, su]);
    expect(accountsFor(member(), 'shares')).toEqual([sh]);
  });

  test('exactly one account is preselected, several are not, none is not', () => {
    expect(preselectedAccountId([sh])).toBe(9);
    expect(preselectedAccountId([ks, su])).toBeNull();
    expect(preselectedAccountId([])).toBeNull();
  });

  test('finds the chosen account, and nothing for no choice or a stale one', () => {
    expect(findAccount([ks, su], 2)).toBe(su);
    expect(findAccount([ks, su], null)).toBeNull();
    expect(findAccount([ks, su], 77)).toBeNull();
  });

  test('the label names the product and the number', () => {
    expect(accountLabel(ks)).toBe('Ordinary Savings · 1-KS');
  });
});

describe('when a deposit action is available', () => {
  test('available with an account of that type', () => {
    expect(depositUnavailableReason(member(), 'savings')).toBeNull();
    expect(depositUnavailableReason(member(), 'shares')).toBeNull();
  });

  test('disabled with a one-line reason when there is no account of the type', () => {
    const noShares = member({ accounts: { savings: [ks], shares: [] } });
    expect(depositUnavailableReason(noShares, 'shares')).toBe('This member has no shares account.');
    expect(depositUnavailableReason(noShares, 'savings')).toBeNull();
    const noSavings = member({ accounts: { savings: [], shares: [sh] } });
    expect(depositUnavailableReason(noSavings, 'savings')).toBe('This member has no savings account.');
  });

  test('disabled for a member who is not active', () => {
    expect(depositUnavailableReason(member({ status: 'INACTIVE' }), 'savings')).toMatch(/not active/);
    expect(depositUnavailableReason(member({ status: 'PENDING_APPROVAL' }), 'shares')).toMatch(/not active/);
  });
});

describe('type, product and kind', () => {
  test('route parameter', () => {
    expect(parseDepositType('savings')).toBe('savings');
    expect(parseDepositType(['shares', 'x'])).toBe('shares');
    expect(parseDepositType('loan')).toBeNull();
    expect(parseDepositType(undefined)).toBeNull();
  });

  test('savings deposits are kind SAVINGS and share contributions are kind SHARES; loans are neither', () => {
    expect(kindForProduct('SAVINGS_DEPOSIT')).toBe('SAVINGS');
    expect(kindForProduct('SHARE_CONTRIBUTION')).toBe('SHARES');
    expect(kindForProduct('LOAN_REPAYMENT')).toBeNull();
    expect(typeForProduct('SHARE_CONTRIBUTION')).toBe('shares');
    expect(typeForProduct('LOAN_REPAYMENT')).toBeNull();
  });

  test('the shares deposit is called "Shares deposit"', () => {
    expect(PRODUCT_LABELS.SHARE_CONTRIBUTION).toBe('Shares deposit');
    expect(depositTitle('shares')).toBe('Shares deposit');
    expect(depositTitle('savings')).toBe('Savings deposit');
  });
});

describe('payment modes', () => {
  test('Mobile Money is not offered while the core cannot handle it', () => {
    expect(availablePaymentModes({ mobileMoney: false })).toEqual(['CASH']);
  });

  test('turning the capability on adds it', () => {
    expect(availablePaymentModes({ mobileMoney: true })).toEqual(['CASH', 'MOBILE_MONEY']);
  });
});

describe('the confirmation summary', () => {
  const input = { member: member(), type: 'savings' as const, account: ks, amount: '40', paymentMode: 'CASH' as const };

  test('lists member, code, account, amount, payment and expected balance', () => {
    const summary = buildDepositSummary(input);
    expect(summary?.title).toBe('Confirm savings deposit');
    expect(summary?.lines).toEqual([
      { label: 'Member', value: 'Ama Mensah' },
      { label: 'Member code', value: '100001' },
      { label: 'Account', value: 'Ordinary Savings · 1-KS' },
      { label: 'Amount', value: 'GHS 40.00' },
      { label: 'Payment', value: 'Cash' },
      { label: 'Expected balance after approval', value: 'GHS 160.50' },
    ]);
  });

  test('uses thousands separators and the shares account for a shares deposit', () => {
    const summary = buildDepositSummary({ ...input, type: 'shares', account: sh, amount: '1234.5' });
    expect(summary?.title).toBe('Confirm shares deposit');
    expect(summary?.lines.find((l) => l.label === 'Account')?.value).toBe('Ordinary Shares · 1-SH');
    expect(summary?.lines.find((l) => l.label === 'Amount')?.value).toBe('GHS 1,234.50');
    expect(summary?.lines.find((l) => l.label.startsWith('Expected'))?.value).toBe('GHS 1,534.50');
  });

  test('says Mobile Money only when that mode was chosen', () => {
    expect(buildDepositSummary({ ...input, paymentMode: 'MOBILE_MONEY' })?.lines.find((l) => l.label === 'Payment')?.value).toBe('Mobile Money');
  });

  test('never promises an SMS', () => {
    const summary = buildDepositSummary(input);
    const text = [summary?.title, summary?.note, ...(summary?.lines ?? []).flatMap((l) => [l.label, l.value])].join(' ');
    expect(text).not.toMatch(/sms|text message/i);
    expect(summary?.note).toMatch(/office approves/);
  });

  test('there is no summary until an account and a valid amount are given', () => {
    expect(buildDepositSummary({ ...input, account: null })).toBeNull();
    expect(buildDepositSummary({ ...input, amount: '' })).toBeNull();
    expect(buildDepositSummary({ ...input, amount: '0' })).toBeNull();
  });
});

describe('sumBalances', () => {
  test('adds in pesewas, with negatives, and ignores unreadable entries', () => {
    expect(sumBalances(['0.10', '0.20'])).toBe('0.30');
    expect(sumBalances(['5.00', '-7.25'])).toBe('-2.25');
    expect(sumBalances(['1.00', 'oops'])).toBe('1.00');
    expect(sumBalances([])).toBe('0.00');
  });
});
