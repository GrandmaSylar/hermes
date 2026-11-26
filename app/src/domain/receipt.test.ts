import { COLUMNS, center, depositReceipt, keyValue, layoutReceipt, printPage, receiptText, registrationReceipt, shortRef, wrap } from './receipt';
import type { RegistrationItem } from './registration';
import type { OutboxItem } from './types';

const item = (over: Partial<OutboxItem> = {}): OutboxItem => ({
  localTransactionId: 'abcd1234-0000-4000-8000-000000000000', memberCode: '1000004764', memberName: 'Nana Kofi Boateng', productType: 'SAVINGS_DEPOSIT', amount: '1250.50',
  reference: null, collectedAt: '2026-11-26T15:05:00.000', status: 'SYNCED', attempts: 0, lastError: null, serverId: '501', createdAt: '2026-11-26T15:05:00.000',
  accountId: 1, accountLabel: 'Ordinary Savings - 1-KS', paymentMode: 'CASH', officeStatus: null, officeReason: null, officeDecidedAt: null, ...over,
});
const head = { creditUnion: 'Assemblies Of God Credit Union Limited', branch: 'Techiman (100)', officer: 'Hermes Test Banker' };

describe('text layout', () => {
  test('wraps at spaces, and breaks a word only when it is wider than the paper', () => {
    expect(wrap('Assemblies Of God Credit Union Limited', 32)).toEqual(['Assemblies Of God Credit Union', 'Limited']);
    expect(wrap('x'.repeat(40), 32)).toEqual(['x'.repeat(32), 'xxxxxxxx']);
    expect(wrap('', 10)).toEqual(['']);
  });

  test('centres, and never overflows', () => {
    expect(center('abc', 9)).toBe('   abc');
    expect(center('x'.repeat(50), 10)).toHaveLength(10);
  });

  test('a label and value share a line when they fit, otherwise the value drops below, right-aligned', () => {
    expect(keyValue('Ref', 'ABCD1234', 20)).toEqual(['Ref         ABCD1234']);
    const long = keyValue('Account', 'Ordinary Savings - 1-KS Plus Extra Long', 32);
    expect(long[0]).toBe('Account');
    expect(long.slice(1).every((l) => l.length === 32 && l.trim().length > 0)).toBe(true);
  });
});

describe('a deposit receipt', () => {
  test.each([58, 80] as const)('no line is wider than %i mm paper', (paper) => {
    const lines = layoutReceipt(depositReceipt(item(), 'PENDING', head, false), COLUMNS[paper]);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(COLUMNS[paper]);
  });

  test('says who, how much, to what, and where it stands', () => {
    const text = receiptText(layoutReceipt(depositReceipt(item(), 'PENDING', head, false), 32));
    expect(text).toContain('DEPOSIT RECEIPT');
    expect(text).toContain('Nana Kofi Boateng');
    expect(text).toContain('1000004764');
    expect(text).toContain('GHS 1,250.50');
    expect(text).toContain('PENDING APPROVAL');
    expect(text).toContain('Hermes Test Banker');
    expect(text).toContain('Assemblies Of God Credit Union');
    expect(text).toContain('ABCD1234');
  });

  test('an approved one has no caveat, a refused one gives the reason', () => {
    const approved = receiptText(layoutReceipt(depositReceipt(item({ officeStatus: 'APPROVED' }), 'APPROVED', head, false), 32));
    expect(approved).toContain('APPROVED');
    expect(approved).not.toContain('posts when');
    const refused = receiptText(layoutReceipt(depositReceipt(item({ officeStatus: 'REJECTED', officeReason: 'Wrong account' }), 'REJECTED', head, false), 32));
    expect(refused).toContain('REJECTED');
    expect(refused).toContain('Wrong account');
  });

  test('a reprint is marked as a copy', () => {
    expect(receiptText(layoutReceipt(depositReceipt(item(), 'PENDING', head, true), 32))).toContain('*** COPY ***');
    expect(receiptText(layoutReceipt(depositReceipt(item(), 'PENDING', head, false), 32))).not.toContain('COPY');
  });

  test('the reference is short and capital', () => {
    expect(shortRef('abcd1234-ffff')).toBe('ABCD1234');
    expect(shortRef('server-1000009999')).toBe('10000099');
  });
});

describe('a registration slip', () => {
  const reg: RegistrationItem = {
    localRegistrationId: 'reg-1', firstName: 'Abena', lastName: 'Owusu', gender: 'F', dateOfBirth: '1990-01-01', phone: '0244000000', idType: 'NATIONAL_ID', idNumber: '',
    address: '', capturedAt: '2026-11-26T09:00:00.000', status: 'SYNCED', attempts: 0, lastError: null, serverId: '1000004770', createdAt: '2026-11-26T09:00:00.000', payload: null, files: [],
  };
  test('names the member, their number and where it stands', () => {
    const text = receiptText(layoutReceipt(registrationReceipt(reg, 'PENDING', head, false), 32));
    expect(text).toContain('MEMBER REGISTRATION');
    expect(text).toContain('Abena Owusu');
    expect(text).toContain('1000004770');
    expect(text).toContain('PENDING APPROVAL');
    expect(text).not.toContain('GHS');
  });
});

describe('the printed page', () => {
  const lines = layoutReceipt(depositReceipt(item(), 'PENDING', head, false), 32);

  test('is as wide as the paper and only as tall as it needs, with the text escaped', () => {
    const page = printPage(lines, 58, null);
    expect(page.width).toBe(164);
    expect(page.height).toBeGreaterThan(lines.length * 8);
    expect(page.html).toContain('size: 58mm');
    expect(page.html).not.toContain('<img');
    expect(printPage(['a < b & c'], 80, null).html).toContain('a &lt; b &amp; c');
    expect(printPage(lines, 80, null).width).toBe(227);
  });

  test('the logo is added when there is one', () => {
    expect(printPage(lines, 58, 'data:image/png;base64,AAAA').html).toContain('<img class="logo" src="data:image/png;base64,AAAA"');
  });

  test('text for a printer app has no trailing spaces', () => {
    for (const l of receiptText(lines).split('\n')) expect(l).toBe(l.replace(/\s+$/, ''));
  });
});
