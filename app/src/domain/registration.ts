import type { OutboxStatus } from './types';

/**
 * Member registration captured in the field. A registration is a draft for the
 * office: the member gets no member number and cannot transact until the office
 * approves the draft (FR-2, brief item 24).
 */

export type IdType = 'GHANA_CARD' | 'VOTER_ID' | 'PASSPORT' | 'DRIVERS_LICENCE' | 'NHIS';

export const ID_TYPE_LABELS: Record<IdType, string> = {
  GHANA_CARD: 'Ghana Card',
  VOTER_ID: 'Voter ID',
  PASSPORT: 'Passport',
  DRIVERS_LICENCE: "Driver's licence",
  NHIS: 'NHIS card',
};

export type Gender = 'F' | 'M';

/** What the mobilizer types into the form. Everything is text until validated. */
export interface RegistrationDraft {
  firstName: string;
  lastName: string;
  gender: Gender | '';
  /** YYYY-MM-DD */
  dateOfBirth: string;
  phone: string;
  idType: IdType | '';
  idNumber: string;
  address: string;
}

export const EMPTY_DRAFT: RegistrationDraft = {
  firstName: '',
  lastName: '',
  gender: '',
  dateOfBirth: '',
  phone: '',
  idType: '',
  idNumber: '',
  address: '',
};

export interface RegistrationItem {
  localRegistrationId: string;
  firstName: string;
  lastName: string;
  gender: Gender;
  dateOfBirth: string;
  /** Local format, 0XXXXXXXXX. */
  phone: string;
  idType: IdType;
  /** Upper case, spaces removed. */
  idNumber: string;
  address: string;
  /** ISO time on the device when the form was saved. */
  capturedAt: string;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  /** The office's draft reference, once the core system has received it. */
  serverId: string | null;
  createdAt: string;
}

export type RegistrationErrors = Partial<Record<keyof RegistrationDraft, string>>;

export const MIN_AGE_YEARS = 18;

/**
 * Accepts 024 123 4567, 0241234567, +233241234567 and 233241234567, and
 * returns the local form 0241234567. Returns null if it is not a Ghana mobile
 * number.
 */
export function normalisePhone(text: string): string | null {
  const compact = text.replace(/[\s\-().]/g, '');
  let local: string;
  if (/^\+?233\d{9}$/.test(compact)) local = `0${compact.replace(/^\+?233/, '')}`;
  else if (/^0\d{9}$/.test(compact)) local = compact;
  else return null;
  // Ghana mobile numbers start 02x or 05x.
  return /^0[25]\d{8}$/.test(local) ? local : null;
}

export function normaliseIdNumber(text: string): string {
  return text.replace(/\s+/g, '').toUpperCase();
}

const GHANA_CARD = /^GHA-\d{9}-\d$/;

function parseDate(text: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  // Rejects dates like 2000-02-31 that JavaScript would roll forward.
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
}

function ageOn(birth: Date, today: Date): number {
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday =
    today.getUTCMonth() < birth.getUTCMonth() ||
    (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/** Returns the problems with a draft, keyed by field. An empty object means it can be saved. */
export function validateRegistration(draft: RegistrationDraft, today: Date = new Date()): RegistrationErrors {
  const errors: RegistrationErrors = {};

  if (draft.firstName.trim().length < 2) errors.firstName = 'Enter the first name.';
  if (draft.lastName.trim().length < 2) errors.lastName = 'Enter the last name.';
  if (draft.gender === '') errors.gender = 'Choose male or female.';

  const birth = parseDate(draft.dateOfBirth);
  if (!birth) errors.dateOfBirth = 'Enter the date of birth as YYYY-MM-DD.';
  else if (birth.getTime() > today.getTime()) errors.dateOfBirth = 'The date of birth cannot be in the future.';
  else if (ageOn(birth, today) < MIN_AGE_YEARS) errors.dateOfBirth = `The member must be at least ${MIN_AGE_YEARS} years old.`;
  else if (ageOn(birth, today) > 110) errors.dateOfBirth = 'Check the date of birth.';

  if (normalisePhone(draft.phone) === null) errors.phone = 'Enter a valid mobile number, for example 024 123 4567.';

  if (draft.idType === '') errors.idType = 'Choose the ID type.';
  const idNumber = normaliseIdNumber(draft.idNumber);
  if (idNumber.length < 5) errors.idNumber = 'Enter the ID number.';
  else if (draft.idType === 'GHANA_CARD' && !GHANA_CARD.test(idNumber)) {
    errors.idNumber = 'A Ghana Card number looks like GHA-123456789-0.';
  }

  if (draft.address.trim().length < 3) errors.address = 'Enter where the member lives.';
  return errors;
}

export const fullName = (r: Pick<RegistrationItem, 'firstName' | 'lastName'>) => `${r.firstName} ${r.lastName}`;
