import { depositStatus, paginate, presetOf, presetRange, rangeLabel, registrationStatus, withFrom, withTo } from './history';

describe('history statuses', () => {
  test('deposits are pending until the office approves, and rejected if refused anywhere', () => {
    expect(depositStatus({ status: 'PENDING', officeStatus: null })).toBe('PENDING');
    expect(depositStatus({ status: 'SYNCED', officeStatus: null })).toBe('PENDING');
    expect(depositStatus({ status: 'SYNCED', officeStatus: 'APPROVED' })).toBe('APPROVED');
    expect(depositStatus({ status: 'SYNCED', officeStatus: 'VERIFIED' })).toBe('APPROVED');
    expect(depositStatus({ status: 'SYNCED', officeStatus: 'REJECTED' })).toBe('REJECTED');
    expect(depositStatus({ status: 'REJECTED', officeStatus: null })).toBe('REJECTED');
    expect(depositStatus({ status: 'CONFLICT', officeStatus: null })).toBe('REJECTED');
  });

  test('a registration is approved once the new member is active', () => {
    expect(registrationStatus({ status: 'PENDING' }, null)).toBe('PENDING');
    expect(registrationStatus({ status: 'SYNCED' }, { status: 'PENDING_APPROVAL' })).toBe('PENDING');
    expect(registrationStatus({ status: 'SYNCED' }, { status: 'ACTIVE' })).toBe('APPROVED');
    expect(registrationStatus({ status: 'REJECTED' }, null)).toBe('REJECTED');
  });
});

describe('pages', () => {
  const rows = Array.from({ length: 45 }, (_, i) => i);
  test('splits into pages and keeps the page in range', () => {
    expect(paginate(rows, 1, 20)).toMatchObject({ page: 1, pages: 3, total: 45 });
    expect(paginate(rows, 3, 20).rows).toHaveLength(5);
    expect(paginate(rows, 9, 20).page).toBe(3);
    expect(paginate(rows, 0, 20).page).toBe(1);
    expect(paginate([], 1)).toEqual({ rows: [], page: 1, pages: 1, total: 0 });
  });
});

describe('date ranges', () => {
  const today = new Date('2026-11-26T10:00:00.000Z');
  test('presets', () => {
    expect(presetRange('today', today)).toEqual({ from: '2026-11-26', to: '2026-11-26' });
    expect(presetRange('7d', today)).toEqual({ from: '2026-11-20', to: '2026-11-26' });
    expect(presetRange('30d', today).from).toBe('2026-10-28');
    expect(presetOf({ from: '2026-11-20', to: '2026-11-26' }, today)).toBe('7d');
    expect(presetOf({ from: '2026-11-01', to: '2026-11-26' }, today)).toBeNull();
  });
  test('labels', () => {
    expect(rangeLabel(presetRange('all', today))).toBe('All time');
    expect(rangeLabel({ from: '2026-11-26', to: '2026-11-26' })).toBe('26 Nov 2026');
    expect(rangeLabel({ from: '2026-11-01', to: '2026-11-26' })).toBe('1 Nov 2026 to 26 Nov 2026');
  });
  test('picking one end never leaves the range backwards', () => {
    expect(withFrom({ from: '2026-11-01', to: '2026-11-10' }, '2026-11-20')).toEqual({ from: '2026-11-20', to: '2026-11-20' });
    expect(withTo({ from: '2026-11-15', to: '2026-11-20' }, '2026-11-10')).toEqual({ from: '2026-11-10', to: '2026-11-10' });
    expect(withFrom(presetRange('all', today), '2026-11-05')).toEqual({ from: '2026-11-05', to: '2026-11-05' });
  });
});
