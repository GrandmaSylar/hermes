import { EMPTY_DRAFT, normaliseIdNumber, normalisePhone, validateRegistration, type RegistrationDraft } from './registration';

const today = new Date('2026-11-18T10:00:00.000Z');

const valid: RegistrationDraft = {
  firstName: 'Ama',
  lastName: 'Mensah',
  gender: 'F',
  dateOfBirth: '1990-04-23',
  phone: '024 123 4567',
  idType: 'GHANA_CARD',
  idNumber: 'gha-123456789-0',
  address: 'Kasoa, Central Region',
};

describe('normalisePhone', () => {
  test('accepts the common ways of writing a Ghana mobile number', () => {
    for (const text of ['0241234567', '024 123 4567', '024-123-4567', '+233241234567', '233241234567', '+233 24 123 4567']) {
      expect(normalisePhone(text)).toBe('0241234567');
    }
    expect(normalisePhone('0501234567')).toBe('0501234567');
  });
  test('rejects numbers that are not Ghana mobiles', () => {
    for (const text of ['', '12345', '024123456', '02412345678', '0341234567', '+441234567890', 'abcdefghij']) {
      expect(normalisePhone(text)).toBeNull();
    }
  });
});

describe('validateRegistration', () => {
  test('a complete form has no errors', () => {
    expect(validateRegistration(valid, today)).toEqual({});
  });

  test('an empty form flags every field', () => {
    expect(Object.keys(validateRegistration(EMPTY_DRAFT, today)).sort()).toEqual(
      ['address', 'dateOfBirth', 'firstName', 'gender', 'idNumber', 'idType', 'lastName', 'phone'].sort(),
    );
  });

  test('date of birth: format, real calendar date, not future, adult only', () => {
    const dob = (dateOfBirth: string) => validateRegistration({ ...valid, dateOfBirth }, today).dateOfBirth;
    expect(dob('23/04/1990')).toMatch(/YYYY-MM-DD/);
    expect(dob('2000-02-31')).toMatch(/YYYY-MM-DD/);
    expect(dob('2027-01-01')).toMatch(/future/);
    expect(dob('1850-01-01')).toMatch(/Check/);
    // Turns 18 tomorrow: still too young. Turned 18 today: allowed.
    expect(dob('2008-11-19')).toMatch(/at least 18/);
    expect(dob('2008-11-18')).toBeUndefined();
  });

  test('a Ghana Card number must have the right shape, other IDs only need a value', () => {
    expect(validateRegistration({ ...valid, idNumber: '123456789' }, today).idNumber).toMatch(/GHA-/);
    expect(validateRegistration({ ...valid, idType: 'PASSPORT', idNumber: 'G1234567' }, today).idNumber).toBeUndefined();
    expect(validateRegistration({ ...valid, idType: 'PASSPORT', idNumber: 'G1' }, today).idNumber).toMatch(/Enter the ID/);
  });

  test('ID numbers are compared without spaces or case', () => {
    expect(normaliseIdNumber(' gha-123456789-0 ')).toBe('GHA-123456789-0');
  });
});
