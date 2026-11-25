import { officeLine } from './office';

describe('what the banker is told about the office', () => {
  const synced = (officeStatus: Parameters<typeof officeLine>[0]['officeStatus'], officeReason: string | null = null) =>
    officeLine({ status: 'SYNCED', officeStatus, officeReason });

  test('says nothing about items that have not reached the office', () => {
    for (const status of ['PENDING', 'SENDING', 'REJECTED', 'CONFLICT'] as const) {
      expect(officeLine({ status, officeStatus: 'APPROVED', officeReason: null })).toBeNull();
    }
  });

  test('a delivered item with no answer yet is waiting for the office', () => {
    expect(synced(null)).toEqual({ text: 'Waiting for the office to approve', tone: 'wait' });
    expect(synced('PENDING')?.tone).toBe('wait');
  });

  test('approved and verified are good news', () => {
    expect(synced('APPROVED')).toEqual({ text: 'Approved by the office', tone: 'good' });
    expect(synced('VERIFIED')).toEqual({ text: 'Approved and checked at end of day', tone: 'good' });
  });

  test('a refusal gives the reason, or tells the banker to ask when there is none', () => {
    expect(synced('REJECTED', 'Wrong amount.')).toEqual({ text: 'Refused by the office: Wrong amount.', tone: 'bad' });
    expect(synced('REJECTED')).toEqual({ text: 'Refused by the office. Ask your supervisor.', tone: 'bad' });
  });
});
