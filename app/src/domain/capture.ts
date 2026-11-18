import { isAmountText, toMinor } from './money';
import type { Member, MobilizerLimits, ProductType } from './types';

export interface UnsyncedTotals {
  count: number;
  /** Two-decimal GHS string. */
  amountMinor: bigint;
}

export interface CaptureInput {
  member: Member;
  productType: ProductType;
  amount: string;
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
  if (input.productType === 'SAVINGS_DEPOSIT' && input.member.savingsAccountId == null) {
    return 'This member has no savings account on this phone yet. Sync, then try again.';
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
