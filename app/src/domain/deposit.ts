import { formatAmount, fromMinor, isAmountText, toMinor } from './money';
import {
  PAYMENT_LABELS,
  PRODUCT_LABELS,
  type AccountOption,
  type DepositKind,
  type Member,
  type PaymentMode,
  type ProductType,
} from './types';

/**
 * The deposit flow. A deposit goes into one account of one type: a savings
 * account or a share holding. Everything here is pure so it can be tested
 * without a phone; the screen only displays what these functions return.
 */

/** What the officer chose on the member screen. Carried in the route as `type`. */
export type DepositType = 'savings' | 'shares';

export const PRODUCT_FOR_TYPE: Record<DepositType, ProductType> = {
  savings: 'SAVINGS_DEPOSIT',
  shares: 'SHARE_CONTRIBUTION',
};

export const KIND_FOR_TYPE: Record<DepositType, DepositKind> = {
  savings: 'SAVINGS',
  shares: 'SHARES',
};

/** Reads the `type` route parameter. Anything else (or nothing) is not a deposit screen. */
export function parseDepositType(value: string | string[] | undefined): DepositType | null {
  const text = Array.isArray(value) ? value[0] : value;
  return text === 'savings' || text === 'shares' ? text : null;
}

/** Savings deposit maps to kind SAVINGS and shares deposit to SHARES. Loan repayments are not deposits. */
export function kindForProduct(product: ProductType): DepositKind | null {
  if (product === 'SAVINGS_DEPOSIT') return 'SAVINGS';
  if (product === 'SHARE_CONTRIBUTION') return 'SHARES';
  return null;
}

export function typeForProduct(product: ProductType): DepositType | null {
  if (product === 'SAVINGS_DEPOSIT') return 'savings';
  if (product === 'SHARE_CONTRIBUTION') return 'shares';
  return null;
}

export const depositTitle = (type: DepositType): string => PRODUCT_LABELS[PRODUCT_FOR_TYPE[type]];

/** Only this type's accounts: savings accounts for a savings deposit, share holdings for a shares deposit. */
export function accountsFor(member: Pick<Member, 'accounts'>, type: DepositType): AccountOption[] {
  return type === 'savings' ? member.accounts.savings : member.accounts.shares;
}

/** "Ordinary Savings · 1-KS". Kept on the outbox item so the sync screen can say where it went. */
export function accountLabel(account: Pick<AccountOption, 'productName' | 'number'>): string {
  return `${account.productName} · ${account.number}`;
}

/** With exactly one account there is nothing to choose, so it is selected up front. */
export function preselectedAccountId(accounts: AccountOption[]): number | null {
  return accounts.length === 1 ? accounts[0].id : null;
}

export function findAccount(accounts: AccountOption[], id: number | null): AccountOption | null {
  return id === null ? null : (accounts.find((a) => a.id === id) ?? null);
}

/**
 * Why this deposit action cannot be used for this member, or null when it can.
 * Shown as one line under the disabled action.
 */
export function depositUnavailableReason(member: Pick<Member, 'status' | 'accounts'>, type: DepositType): string | null {
  if (member.status !== 'ACTIVE') return 'This member is not active.';
  if (accountsFor(member, type).length === 0) {
    return type === 'savings' ? 'This member has no savings account.' : 'This member has no shares account.';
  }
  return null;
}

/** The modes the officer may pick from. Mobile Money appears only once the core can handle it. */
export function availablePaymentModes(capabilities: { mobileMoney: boolean }): PaymentMode[] {
  return capabilities.mobileMoney ? ['CASH', 'MOBILE_MONEY'] : ['CASH'];
}

/** A core balance in pesewas. Unlike entered amounts, a balance can be negative (an overdrawn account). */
function balanceToMinor(balance: string): bigint | null {
  const text = balance.trim();
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  if (!isAmountText(unsigned)) return null;
  const minor = toMinor(unsigned);
  return negative ? -minor : minor;
}

/** Sum of core balances in pesewas, as a two-decimal string. Unreadable entries count as zero. */
export function sumBalances(values: string[]): string {
  return fromMinor(values.reduce((total, v) => total + (balanceToMinor(v) ?? 0n), 0n));
}

/**
 * The balance the account will have once the office approves this deposit:
 * the balance last read from the core plus the amount, in integer pesewas.
 * Null unless both are valid and the amount is above zero, so the screen shows
 * nothing rather than a wrong number.
 */
export function expectedBalance(account: Pick<AccountOption, 'balance'> | null, amount: string): string | null {
  if (!account || !isAmountText(amount)) return null;
  const add = toMinor(amount);
  if (add <= 0n) return null;
  const current = balanceToMinor(account.balance);
  if (current === null) return null;
  return fromMinor(current + add);
}

export interface SummaryLine {
  label: string;
  value: string;
}

export interface DepositSummary {
  title: string;
  lines: SummaryLine[];
  /** Plain text the confirmation window repeats under the lines. */
  note: string;
}

/**
 * What the confirmation window shows. Null when anything is missing or the
 * amount is not valid, so a window can never open on half the facts.
 */
export function buildDepositSummary(input: {
  member: Pick<Member, 'name' | 'memberCode'>;
  type: DepositType;
  account: AccountOption | null;
  amount: string;
  paymentMode: PaymentMode;
}): DepositSummary | null {
  const expected = expectedBalance(input.account, input.amount);
  if (!input.account || expected === null) return null;
  return {
    title: `Confirm ${depositTitle(input.type).toLowerCase()}`,
    lines: [
      { label: 'Member', value: input.member.name },
      { label: 'Member code', value: input.member.memberCode },
      { label: 'Account', value: accountLabel(input.account) },
      { label: 'Amount', value: `GHS ${formatAmount(input.amount)}` },
      { label: 'Payment', value: PAYMENT_LABELS[input.paymentMode] },
      { label: 'Expected balance after approval', value: `GHS ${formatAmount(expected)}` },
    ],
    note: 'Saved on this phone, then sent to the office. The balance changes only after the office approves it.',
  };
}
