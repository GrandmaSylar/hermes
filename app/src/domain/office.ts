import type { OutboxItem } from './types';

export type OfficeTone = 'wait' | 'good' | 'bad';

export interface OfficeLine {
  text: string;
  tone: OfficeTone;
}

/**
 * What to tell the banker about a collection the office may have acted on.
 * Only items that reached the server have anything to say; anything still on
 * the phone is covered by its own sync status.
 */
export function officeLine(item: Pick<OutboxItem, 'status' | 'officeStatus' | 'officeReason'>): OfficeLine | null {
  if (item.status !== 'SYNCED') return null;
  switch (item.officeStatus) {
    case 'APPROVED':
      return { text: 'Approved by the office', tone: 'good' };
    case 'VERIFIED':
      return { text: 'Approved and checked at end of day', tone: 'good' };
    case 'REJECTED':
      return {
        text: item.officeReason ? `Refused by the office: ${item.officeReason}` : 'Refused by the office. Ask your supervisor.',
        tone: 'bad',
      };
    case 'PENDING':
    case null:
    default:
      return { text: 'Waiting for the office to approve', tone: 'wait' };
  }
}
