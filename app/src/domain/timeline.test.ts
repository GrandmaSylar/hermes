import { depositTimeline, registrationTimeline } from './timeline';
import type { RegistrationItem } from './registration';
import type { OutboxItem } from './types';

const dep = (over: Partial<OutboxItem> = {}): OutboxItem => ({
  localTransactionId: 'x', memberCode: '1', memberName: 'A', productType: 'SAVINGS_DEPOSIT', amount: '10.00', reference: null, collectedAt: '2026-11-26T09:00:00.000Z',
  status: 'PENDING', attempts: 0, lastError: null, serverId: null, createdAt: '2026-11-26T09:00:00.000Z', accountId: 1, accountLabel: null, paymentMode: 'CASH',
  officeStatus: null, officeReason: null, officeDecidedAt: null, ...over,
});
const states = (steps: { state: string }[]) => steps.map((s) => s.state);

describe('deposit steps', () => {
  test('not yet sent: saved, then waiting to sync, then nothing yet', () => {
    expect(states(depositTimeline(dep(), 'PENDING'))).toEqual(['done', 'current', 'todo']);
  });
  test('sent and waiting for the office', () => {
    expect(states(depositTimeline(dep({ status: 'SYNCED' }), 'PENDING'))).toEqual(['done', 'done', 'current']);
  });
  test('approved ends with the time it was posted', () => {
    const steps = depositTimeline(dep({ status: 'SYNCED', officeStatus: 'APPROVED', officeDecidedAt: '2026-11-26T12:00:00.000Z' }), 'APPROVED');
    expect(states(steps)).toEqual(['done', 'done', 'done']);
    expect(steps[2].detail).toBe('2026-11-26T12:00:00.000Z');
  });
  test('refused by the office gives the reason', () => {
    const steps = depositTimeline(dep({ status: 'SYNCED', officeStatus: 'REJECTED', officeReason: 'Wrong account' }), 'REJECTED');
    expect(states(steps)).toEqual(['done', 'done', 'failed']);
    expect(steps[2].detail).toBe('Wrong account');
  });
  test('refused when it arrived shows the server reason', () => {
    const steps = depositTimeline(dep({ status: 'REJECTED', lastError: 'Over the limit' }), 'REJECTED');
    expect(states(steps)).toEqual(['done', 'done', 'failed']);
    expect(steps[2].detail).toBe('Over the limit');
  });
});

describe('registration steps', () => {
  const reg = (over: Partial<RegistrationItem> = {}): RegistrationItem => ({
    localRegistrationId: 'r', firstName: 'A', lastName: 'B', gender: 'F', dateOfBirth: '', phone: '', idType: 'NATIONAL_ID', idNumber: '', address: '', capturedAt: '2026-11-26T09:00:00.000Z',
    status: 'SYNCED', attempts: 0, lastError: null, serverId: '1000004770', createdAt: '2026-11-26T09:00:00.000Z', payload: null, files: [], ...over,
  });
  test('sent and waiting, approved, refused', () => {
    expect(states(registrationTimeline(reg(), 'PENDING'))).toEqual(['done', 'done', 'current']);
    expect(states(registrationTimeline(reg(), 'APPROVED'))).toEqual(['done', 'done', 'done']);
    expect(states(registrationTimeline(reg({ status: 'REJECTED', lastError: 'Duplicate ID' }), 'REJECTED'))).toEqual(['done', 'done', 'failed']);
    expect(registrationTimeline(reg({ status: 'PENDING', serverId: null }), 'PENDING')[1].detail).toBe('Waiting to sync');
  });
});
