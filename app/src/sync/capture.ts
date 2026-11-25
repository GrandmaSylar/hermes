import type { Repos } from '@/data/repositories';
import { validateCapture } from '@/domain/capture';
import { accountLabel } from '@/domain/deposit';
import { normaliseAmount } from '@/domain/money';
import type { AccountOption, Member, OutboxItem, PaymentMode, ProductType, Session } from '@/domain/types';

export interface CollectionInput {
  member: Member;
  productType: ProductType;
  amount: string;
  reference?: string;
  /** The account chosen for a savings or shares deposit. */
  account?: AccountOption | null;
  /** Defaults to cash. */
  paymentMode?: PaymentMode;
  /** The modes this build offers (from the API's capabilities). Defaults to cash only. */
  allowedPaymentModes?: PaymentMode[];
}

export type CaptureResult =
  | { ok: true; item: OutboxItem }
  | { ok: false; error: string };

/**
 * Saves a collection to the on-device outbox. Nothing here talks to the
 * network: the entry is safe on the phone the moment this returns, and the
 * sync engine delivers it later. The localTransactionId generated here is the
 * idempotency key for the entry's whole life.
 */
export async function captureCollection(
  repos: Repos,
  session: Session,
  input: CollectionInput,
  newId: () => string,
  now: () => Date = () => new Date(),
): Promise<CaptureResult> {
  const unsynced = await repos.outbox.unsyncedTotals();
  const error = validateCapture(
    {
      member: input.member,
      productType: input.productType,
      amount: input.amount,
      account: input.account,
      paymentMode: input.paymentMode,
      allowedPaymentModes: input.allowedPaymentModes,
    },
    unsynced,
    session.limits,
  );
  if (error) return { ok: false, error };

  const stamp = now().toISOString();
  const item = {
    localTransactionId: newId(),
    memberCode: input.member.memberCode,
    memberName: input.member.name,
    productType: input.productType,
    amount: normaliseAmount(input.amount),
    reference: input.reference?.trim() ? input.reference.trim() : null,
    collectedAt: stamp,
    createdAt: stamp,
    accountId: input.account?.id ?? null,
    accountLabel: input.account ? accountLabel(input.account) : null,
    paymentMode: input.paymentMode ?? 'CASH',
  };
  await repos.outbox.enqueue(item);
  await repos.members.bumpCollectCount(input.member.memberCode);
  return {
    ok: true,
    item: { ...item, status: 'PENDING', attempts: 0, lastError: null, serverId: null, officeStatus: null, officeReason: null, officeDecidedAt: null },
  };
}
