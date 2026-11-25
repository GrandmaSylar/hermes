import { isAmountText, toMinor } from './money';
import { accountsFor, depositUnavailableReason, typeForProduct } from './deposit';
import type { AccountOption, Member, MobilizerLimits, PaymentMode, ProductType } from './types';

export interface UnsyncedTotals {
  count: number;
  /** Two-decimal GHS string. */
  amountMinor: bigint;
}

export interface CaptureInput {
  member: Member;
  productType: ProductType;
  amount: string;
  /** The account the deposit goes to. Required for savings and shares deposits. */
  account?: AccountOption | null;
  /** Defaults to cash. */
  paymentMode?: PaymentMode;
  /** The modes this build offers. Defaults to cash only. */
  allowedPaymentModes?: PaymentMode[];
}

/**
 * Local checks before a collection is saved. The core system repeats and
 * enforces every rule at sync, so this only stops obvious mistakes and keeps
 * the amount of unsynced cash on a lost phone bounded.
 */
export function validateCapture(
  input: CaptureInput,
  unsynced: UnsyncedTotals,
  limits: MobilizerLimits,
): string | null {
  if (input.member.status !== 'ACTIVE') {
    return 'This member is not active, so a collection cannot be captured.';
  }
  const type = typeForProduct(input.productType);
  if (type) {
    const unavailable = depositUnavailableReason(input.member, type);
    if (unavailable) return unavailable;
    if (!input.account) return 'Choose the account for this deposit.';
    // The chosen account must be one of this member's accounts of the right type.
    if (!accountsFor(input.member, type).some((a) => a.id === input.account?.id)) {
      return 'That account does not belong to this member. Choose again.';
    }
  }
  if (!(input.allowedPaymentModes ?? ['CASH']).includes(input.paymentMode ?? 'CASH')) {
    return 'This payment mode is not available yet. Choose Cash.';
  }
  if (!input.amount.trim()) return 'Enter the amount.';
  if (!isAmountText(input.amount)) return 'Enter a valid amount with at most two decimals.';
  const minor = toMinor(input.amount);
  if (minor <= 0n) return 'The amount must be greater than zero.';
  if (minor > toMinor(limits.maxSingleAmount)) {
    return `A single collection cannot exceed GHS ${limits.maxSingleAmount}.`;
  }
  if (unsynced.count >= limits.maxUnsyncedItems) {
    return 'Too many items are waiting to sync. Connect to the network and sync before collecting more.';
  }
  if (unsynced.amountMinor + minor > toMinor(limits.maxUnsyncedAmount)) {
    return 'The cash waiting to sync would exceed your limit. Sync before collecting more.';
  }
  return null;
}
