import {
  DEFAULT_MEMBER_TYPES,
  EMPTY_FORM,
  STEPS,
  ageOn,
  formatDisplayDate,
  formatGhanaCard,
  isFullName,
  isGhanaPhone,
  needsGuardian,
  normaliseIdNumber,
  parseDisplayDate,
  primaryId,
  toPayload,
  validateAll,
  validateStep,
  type RegistrationForm,
} from './registration';
import { ben, validForm } from '@/test/registration-form';

const today = new Date('2026-11-25T12:00:00.000Z');
const types = DEFAULT_MEMBER_TYPES;

const messages = (form: RegistrationForm) => validateAll(form, types, today).flatMap((r) => r.problems.map((p) => p.message));

describe('registration rules (the same as the office form)', () => {
  test('a complete adult registration has no problems on any step', () => {
    expect(validateAll(validForm(), types, today)).toEqual([]);
  });

  test('required personal fields', () => {
    expect(messages(validForm({ memberType: '' }))).toContain('Member Type is required');
    expect(messages(validForm({ firstName: '' }))).toContain('First Name is required');
    expect(messages(validForm({ lastName: ' ' }))).toContain('Last Name is required');
    expect(messages(validForm({ sex: '' }))).toContain('Gender is required');
    expect(messages(validForm({ birthDate: '' }))).toContain('Date of Birth is required');
    expect(messages(validForm({ birthDate: '1990-02-31' }))).toContain('Invalid Date of Birth');
    expect(messages(validForm({ birthDate: '2027-01-01' }))).toContain('Date of Birth cannot be in the future');
    expect(messages(validForm({ firstName: 'Sam1' }))).toContain('First Name can only have letters');
  });

  test('any one ID will do, and each ID given must be well formed', () => {
    expect(messages(validForm({ nationalId: '', voterIdNo: 'AB12345678' }))).toEqual([]);
    expect(messages(validForm({ nationalId: '', nhisNo: 'NH-12345' }))).toEqual([]);
    expect(messages(validForm({ nationalId: '', passportNo: 'G1234567' }))).toEqual([]);
    expect(messages(validForm({ nationalId: '' }))).toContain('Enter at least one ID: Ghana Card, voter ID, NHIS card or passport.');
    expect(messages(validForm({ nationalId: 'GHA-12-3' }))).toContain('Ghana Card number must look like GHA-123456789-0.');
    expect(messages(validForm({ voterIdNo: 'abc' }))).toContain('Voter ID should be 6 to 15 letters or digits.');
  });

  test('phone, email and address', () => {
    expect(messages(validForm({ phone: '12345' }))).toContain('Invalid primary phone number');
    expect(messages(validForm({ phone: '+233 24 412 3456' }))).toEqual([]);
    expect(messages(validForm({ email: 'nope' }))).toContain('Invalid email address format');
    expect(messages(validForm({ email: 'kofi@example.com' }))).toEqual([]);
    expect(messages(validForm({ mobileAlert: '999' }))).toContain('Invalid mobile alert number');
    expect(messages(validForm({ residentialAddress: '' }))).toContain('Residential Address is required');
    expect(messages(validForm({ region: '' }))).toContain('Region is required');
    expect(messages(validForm({ city: '' }))).toContain('City is required');
  });

  test('a minor needs a guardian with an ID and a valid phone', () => {
    const minor = { birthDate: '2015-06-01' };
    expect(messages(validForm(minor))).toContain('Guardian information required for minor accounts');
    const partial = validForm({ ...minor, guardian: { ...EMPTY_FORM.guardian, name: 'Kofi Boateng' } });
    expect(messages(partial)).toEqual(
      expect.arrayContaining(['Guardian ID number is required (Ghana Card, voter ID, NHIS or passport)', 'Guardian phone number is required and must be valid']),
    );
    const full = validForm({ ...minor, guardian: { ...EMPTY_FORM.guardian, name: 'Kofi Boateng', nationalId: 'GHA-111111111-1', phone: '0201234567' } });
    expect(messages(full)).toEqual([]);
  });

  test('a Kiddy Savings member needs a guardian whatever the birth date says', () => {
    expect(needsGuardian({ birthDate: '1990-01-01', memberType: 'KID' }, types, today)).toBe(true);
    expect(needsGuardian({ birthDate: '1990-01-01', memberType: 'IND' }, types, today)).toBe(false);
    expect(messages(validForm({ memberType: 'KID' }))).toContain('Guardian information required for minor accounts');
  });

  test('beneficiaries must total 100% and have two names', () => {
    expect(messages(validForm({ beneficiaries: [] }))).toContain('Beneficiaries must total 100% (current 0%)');
    expect(messages(validForm({ beneficiaries: [ben('Ama Akuffo', '60')] }))).toContain('Beneficiaries must total 100% (current 60%)');
    expect(messages(validForm({ beneficiaries: [ben('Ama Akuffo', '33.3'), ben('Yaw Akuffo', '66.7')] }))).toEqual([]);
    expect(messages(validForm({ beneficiaries: [ben('Ama', '100')] }))).toContain('Beneficiary 1: full name must include at least two names');
    expect(messages(validForm({ beneficiaries: [ben('Ama Akuffo', '100', { isMinor: true })] }))).toEqual(
      expect.arrayContaining(['Beneficiary 1: guardian name required', 'Beneficiary 1: invalid guardian phone']),
    );
  });

  test('a problem names the field to highlight', () => {
    const [personal] = validateAll(validForm({ firstName: '' }), types, today);
    expect(personal.step).toBe('personal');
    expect(personal.problems[0]).toEqual({ field: 'firstName', message: 'First Name is required' });
    expect(validateStep('employment', validForm({ yearsWithEmployer: 'x' }), types, today)[0].field).toBe('yearsWithEmployer');
    expect(STEPS).toHaveLength(7);
  });
});

describe('field helpers', () => {
  test('the Ghana Card is laid out as digits are typed', () => {
    expect(formatGhanaCard('')).toBe('');
    expect(formatGhanaCard('gha123')).toBe('GHA-123');
    expect(formatGhanaCard('1234567890')).toBe('GHA-123456789-0');
    expect(formatGhanaCard('GHA-123456789-0')).toBe('GHA-123456789-0');
  });
  test('other IDs are upper-cased with spaces removed', () => {
    expect(normaliseIdNumber('VOTER_ID', ' ab 1234 56 ')).toBe('AB123456');
  });
  test('phone, full name and age', () => {
    expect(isGhanaPhone('0244123456')).toBe(true);
    expect(isGhanaPhone('+233244123456')).toBe(true);
    expect(isGhanaPhone('244123456')).toBe(false);
    expect(isFullName("Ama O'Neil-Mensah")).toBe(true);
    expect(isFullName('Ama')).toBe(false);
    expect(ageOn('2008-11-26', today)).toBe(17);
    expect(ageOn('2008-11-25', today)).toBe(18);
    expect(ageOn('nonsense', today)).toBeNull();
  });
  test('dates are typed day first and stored year first', () => {
    expect(parseDisplayDate('23/04/1990')).toBe('1990-04-23');
    expect(parseDisplayDate('3-4-1990')).toBe('1990-04-03');
    expect(parseDisplayDate('31/02/1990')).toBe('');
    expect(parseDisplayDate('1990')).toBe('');
    expect(formatDisplayDate('1990-04-23')).toBe('23/04/1990');
  });
});

describe('what is sent', () => {
  test('text is tidied, IDs are upper-cased, percentages become numbers', () => {
    const form = validForm({ firstName: '  Samuel ', nationalId: 'gha1234567890', voterIdNo: ' ab 12 34 56 ', email: ' a@b.com ' });
    const p = toPayload(form, 'reg-1', '2026-11-25T11:00:00.000Z', types, today);
    expect(p).toMatchObject({ localRegistrationId: 'reg-1', firstName: 'Samuel', nationalId: 'GHA-123456789-0', voterIdNo: 'AB123456', email: 'a@b.com', guardian: null });
    expect(p.beneficiaries[0].percentage).toBe(100);
  });
  test('the guardian is sent when one is needed or entered', () => {
    const minor = validForm({ birthDate: '2015-06-01', guardian: { ...EMPTY_FORM.guardian, name: 'Kofi Boateng', nationalId: 'gha-111111111-1', phone: '0201234567' } });
    expect(toPayload(minor, 'r', 's', types, today).guardian).toMatchObject({ name: 'Kofi Boateng', nationalId: 'GHA-111111111-1' });
  });
  test('the first ID given is the main one', () => {
    const p = toPayload(validForm({ nationalId: '', passportNo: 'g1234567' }), 'r', 's', types, today);
    expect(primaryId(p)).toMatchObject({ value: 'G1234567', type: { idType: 'PASSPORT' } });
    expect(primaryId(toPayload(validForm(), 'r', 's', types, today))?.type.idType).toBe('NATIONAL_ID');
  });
});
