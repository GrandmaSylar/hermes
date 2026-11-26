import type { ServerDeposit, ServerRegistration } from '@/data/api/contract';
import type { ImportedDeposit, ImportedRegistration } from '@/data/repositories';
import type { OfficeStatus, ProductType } from '@/domain/types';

/**
 * Keeping the officer's own history with the officer, not the phone: the deposits and members they have captured
 * before. The server holds the truth; a phone is a cache that fills itself on sign-in.
 */

// ---- activity ------------------------------------------------------------------------------------------------

const OFFICE_STATUS: Record<string, OfficeStatus> = { PENDING: 'PENDING', APPROVED: 'APPROVED', VERIFIED: 'VERIFIED', REJECTED: 'REJECTED' };

/** A server deposit as an item for the phone's history, or null when it is not one the app knows how to show. */
export function toImportedDeposit(d: ServerDeposit, memberName: string | null): ImportedDeposit | null {
  const officeStatus = OFFICE_STATUS[d.status];
  if (!officeStatus || !d.localTransactionId || !d.memberCode || !d.createdAt) return null;
  const productType: ProductType = d.kind === 'SHARES' ? 'SHARE_CONTRIBUTION' : 'SAVINGS_DEPOSIT';
  return {
    localTransactionId: d.localTransactionId,
    memberCode: d.memberCode,
    memberName: memberName ?? `Member ${d.memberCode}`,
    productType,
    amount: d.amount,
    collectedAt: d.createdAt,
    serverId: d.serverId,
    officeStatus,
    officeReason: officeStatus === 'REJECTED' ? d.reason : null,
    officeDecidedAt: d.decidedAt,
  };
}

export function toImportedRegistration(r: ServerRegistration): ImportedRegistration | null {
  if (!r.memberCode || !r.createdAt) return null;
  return {
    serverId: r.memberCode,
    firstName: r.firstName || 'Member',
    lastName: r.lastName || r.memberCode,
    gender: r.sex.trim().toUpperCase().startsWith('M') ? 'M' : 'F',
    dateOfBirth: r.birthDate ?? '',
    phone: r.phone,
    capturedAt: r.createdAt,
  };
}
