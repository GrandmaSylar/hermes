import type { Repos } from '@/data/repositories';
import { validateCapture } from '@/domain/capture';
import { normaliseAmount } from '@/domain/money';
import type { Member, OutboxItem, ProductType, Session } from '@/domain/types';

export interface CollectionInput {
  member: Member;
  productType: ProductType;
  amount: string;
  reference?: string;
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
    { member: input.member, productType: input.productType, amount: input.amount },
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
    accountId: input.member.savingsAccountId,
  };
  await repos.outbox.enqueue(item);
  await repos.members.bumpCollectCount(input.member.memberCode);
  return {
    ok: true,
    item: { ...item, status: 'PENDING', attempts: 0, lastError: null, serverId: null, officeStatus: null, officeReason: null, officeDecidedAt: null },
  };
}
