import type { HistoryStatus } from './history';
import type { RegistrationItem } from './registration';
import type { OutboxItem } from './types';

/** The steps an item goes through, and which it has reached, for the details screens. */

export type StepState = 'done' | 'current' | 'failed' | 'todo';

export interface TimelineStep {
  label: string;
  /** A sentence or a time. */
  detail: string | null;
  state: StepState;
}

/** Saved on the phone, sent to the office, then the office's answer. */
export function depositTimeline(item: OutboxItem, status: HistoryStatus): TimelineStep[] {
  const sent = item.status === 'SYNCED';
  const refusedAtDoor = item.status === 'REJECTED' || item.status === 'CONFLICT';
  const steps: TimelineStep[] = [{ label: 'Saved on this phone', detail: item.collectedAt, state: 'done' }];

  if (refusedAtDoor) {
    steps.push({ label: 'Sent to the office', detail: null, state: 'done' });
    steps.push({ label: 'Refused', detail: item.lastError || 'The office did not accept this deposit.', state: 'failed' });
    return steps;
  }
  steps.push({ label: 'Sent to the office', detail: sent ? null : 'Waiting to sync', state: sent ? 'done' : 'current' });
  if (status === 'APPROVED') steps.push({ label: 'Approved and posted', detail: item.officeDecidedAt, state: 'done' });
  else if (status === 'REJECTED') steps.push({ label: 'Refused by the office', detail: item.officeReason || 'Ask your supervisor.', state: 'failed' });
  else steps.push({ label: 'Waiting for the office to approve', detail: null, state: sent ? 'current' : 'todo' });
  return steps;
}

export function registrationTimeline(reg: RegistrationItem, status: HistoryStatus): TimelineStep[] {
  const sent = reg.status === 'SYNCED';
  const steps: TimelineStep[] = [{ label: 'Saved on this phone', detail: reg.capturedAt, state: 'done' }];
  if (status === 'REJECTED') {
    steps.push({ label: 'Sent to the office', detail: null, state: 'done' });
    steps.push({ label: 'Refused', detail: reg.lastError || 'The office did not accept this registration.', state: 'failed' });
    return steps;
  }
  steps.push({ label: 'Sent to the office', detail: sent ? (reg.serverId ? `Member number ${reg.serverId}` : null) : 'Waiting to sync', state: sent ? 'done' : 'current' });
  if (status === 'APPROVED') steps.push({ label: 'Approved. The member can transact', detail: null, state: 'done' });
  else steps.push({ label: 'Waiting for the office to approve', detail: null, state: sent ? 'current' : 'todo' });
  return steps;
}
