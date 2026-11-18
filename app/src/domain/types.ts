/** What a mobilizer can collect in v1: cash only, no withdrawals. */
export type ProductType = 'SAVINGS_DEPOSIT' | 'SHARE_CONTRIBUTION' | 'LOAN_REPAYMENT';

export const PRODUCT_LABELS: Record<ProductType, string> = {
  SAVINGS_DEPOSIT: 'Savings deposit',
  SHARE_CONTRIBUTION: 'Share contribution',
  LOAN_REPAYMENT: 'Loan repayment',
};

/**
 * Lifecycle of a captured item on the device.
 *  PENDING   saved locally, waiting to sync
 *  SENDING   being pushed right now
 *  SYNCED    the core system has received it (it then awaits office approval)
 *  REJECTED  the core system refused it; the mobilizer sees the reason
 *  CONFLICT  same local id re-sent with different details; needs attention
 */
export type OutboxStatus = 'PENDING' | 'SENDING' | 'SYNCED' | 'REJECTED' | 'CONFLICT';

/**
 * Balances as last read from the core system. The core's member list has no
 * balances, so shares and loan are null ("not available") until the core
 * exposes them for the field channel.
 */
export interface MemberBalances {
  savings: string;
  shares: string | null;
  loan: string | null;
}

export interface Member {
  memberCode: string;
  name: string;
  phone: string;
  status: 'ACTIVE' | 'PENDING_APPROVAL' | 'INACTIVE';
  branchCode: string;
  balances: MemberBalances;
  /** When these balances were last refreshed from the core system. */
  asOf: string;
  /** The member's savings account at the core system. Deposits need it. Null until synced. */
  savingsAccountId: number | null;
  myCustomer: boolean;
  /** How many items the mobilizer has captured for this member. Drives suggestions. */
  collectCount: number;
}

export interface OutboxItem {
  localTransactionId: string;
  memberCode: string;
  memberName: string;
  productType: ProductType;
  /** Two-decimal GHS amount string. */
  amount: string;
  reference: string | null;
  /** ISO time on the device when the money was collected. */
  collectedAt: string;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  serverId: string | null;
  createdAt: string;
  /** The core system's savings account id, copied from the member when the item was captured. */
  accountId: number | null;
}

export interface MobilizerLimits {
  /** Maximum items waiting to sync before capture is blocked. */
  maxUnsyncedItems: number;
  /** Maximum total of unsynced amounts (GHS) before capture is blocked. */
  maxUnsyncedAmount: string;
  /** Maximum for a single collection (GHS). */
  maxSingleAmount: string;
}

export interface Session {
  officerId: string;
  officerName: string;
  branchCode: string;
  deviceId: string;
  accessToken: string;
  refreshToken: string;
  limits: MobilizerLimits;
}
