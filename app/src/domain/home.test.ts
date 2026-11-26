import { ago, computeHomeFigures, firstName, greeting } from './home';
import type { OutboxItem } from './types';

const item = (over: Partial<OutboxItem>): OutboxItem => ({
  localTransactionId: 'x', memberCode: '1', memberName: 'A', productType: 'SAVINGS_DEPOSIT', amount: '10.00', reference: null,
  collectedAt: '2026-11-26T09:00:00.000Z', status: 'PENDING', attempts: 0, lastError: null, serverId: null, createdAt: '2026-11-26T09:00:00.000Z',
  accountId: 1, accountLabel: null, paymentMode: 'CASH', officeStatus: null, officeReason: null, officeDecidedAt: null, ...over,
});

describe('home figures', () => {
  test('count today and all time, leaving out refused cash', () => {
    const f = computeHomeFigures(
      [
        item({ amount: '100.50' }),
        item({ amount: '20.00', status: 'SYNCED', officeStatus: 'APPROVED' }),
        item({ amount: '5.00', status: 'REJECTED' }),
        item({ amount: '7.00', status: 'SYNCED', officeStatus: 'REJECTED' }),
        item({ amount: '40.00', collectedAt: '2026-11-20T09:00:00.000Z', status: 'SYNCED', officeStatus: 'PENDING' }),
      ],
      '2026-11-26',
    );
    expect(f.today).toEqual({ count: 2, amount: '120.50' });
    expect(f.allTime).toEqual({ count: 3, amount: '160.50' });
    expect(f.waitingToSync).toBe(1);
    expect(f.needAttention).toBe(1);
    expect(f.awaitingOffice).toBe(1);
  });

  test('nothing yet is zero, not blank', () => {
    expect(computeHomeFigures([], '2026-11-26').today).toEqual({ count: 0, amount: '0.00' });
  });
});

describe('home wording', () => {
  test('first name and greeting', () => {
    expect(firstName('  Barnabas  Nyande ')).toBe('Barnabas');
    expect(greeting(new Date(2026, 0, 1, 8))).toBe('Good morning');
    expect(greeting(new Date(2026, 0, 1, 14))).toBe('Good afternoon');
    expect(greeting(new Date(2026, 0, 1, 20))).toBe('Good evening');
  });

  test('how long ago the phone synced', () => {
    const now = new Date('2026-11-26T12:00:00.000Z');
    expect(ago(null, now)).toBe('Never synced');
    expect(ago('2026-11-26T11:59:40.000Z', now)).toBe('Synced just now');
    expect(ago('2026-11-26T11:30:00.000Z', now)).toBe('Synced 30 min ago');
    expect(ago('2026-11-26T09:00:00.000Z', now)).toBe('Synced 3 h ago');
  });
});
