import type { OutboxStatus } from './types';

/**
 * Member registration captured in the field. The form and its rules are copied from the core
 * banking app's registration (CustomerOnboarding), for individual members: the member is saved
 * as pending, and the office approves them. Nothing here talks to the network, so it all works
 * offline.
 */

// ---- choices on the form ------------------------------------------------

export const TITLES = [
  'Mr.', 'Mrs.', 'Ms.', 'Rev.', 'Sister', 'Brother', 'Naa', 'Naaba', 'Nana', 'Nii', 'Togbe', 'Mama', 'Alhaji', 'Hajia',
  'Honorable', 'Deaconess', 'Apostle', 'Pastor', 'Elder', 'Dr.', 'Prof.',
] as const;
export const SEXES = ['Male', 'Female'] as const;
export const MARITAL_STATUSES = ['Single', 'Married', 'Divorced', 'Widowed', 'Separated', 'N/A'] as const;
export const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Contract', 'Self-employed'] as const;
export const SOURCES_OF_FUNDS: { value: string; label: string }[] = [
  { value: 'Salary/Wages', label: 'Salary / Wages' },
  { value: 'Business Income', label: 'Business Income' },
  { value: 'Investment Returns', label: 'Investment Returns' },
  { value: 'Pension', label: 'Pension' },
  { value: 'Remittance', label: 'Remittance' },
  { value: 'Other', label: 'Other' },
];
export const TRANSACTION_VOLUMES: { value: string; label: string }[] = [
  { value: 'Low', label: 'Low (< GHS 1,000/month)' },
  { value: 'Medium', label: 'Medium (GHS 1,000 – 10,000/month)' },
  { value: 'High', label: 'High (> GHS 10,000/month)' },
];
export const BENEFICIARY_RELATIONSHIPS = ['Spouse', 'Child', 'Parent', 'Sibling', 'Guardian', 'Friend', 'Other'] as const;

// ---- member types -------------------------------------------------------

export interface MemberTypeOption {
  code: string;
  label: string;
  /** No share deposit is needed at approval. */
  sharesOptional: boolean;
  /** A guardian is always needed, whatever the birth date says. */
  guardianRequired: boolean;
}

/** Used until the list has been fetched from the server once. The office's own list replaces it. */
export const DEFAULT_MEMBER_TYPES: MemberTypeOption[] = [
  { code: 'IND', label: 'INDIVIDUAL', sharesOptional: false, guardianRequired: false },
  { code: 'YTH', label: 'YOUTH SAVINGS', sharesOptional: true, guardianRequired: false },
  { code: 'KID', label: 'KIDDY SAVINGS', sharesOptional: true, guardianRequired: true },
  { code: 'STD', label: 'STUDENT', sharesOptional: true, guardianRequired: false },
];

/** What choosing a member type means, shown under the choice. */
export function memberTypeHelp(type: MemberTypeOption | undefined): string {
  if (!type) return 'Choose the member type first. It sets the share-deposit rule.';
  return [
    type.sharesOptional ? 'No share deposit is required at approval.' : 'A share deposit is required at approval.',
    type.guardianRequired ? 'Guardian details are required.' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

// ---- identification -----------------------------------------------------

export type IdKey = 'GHANA_CARD' | 'VOTER_ID' | 'NHIS' | 'PASSPORT';
export type IdField = 'nationalId' | 'voterIdNo' | 'nhisNo' | 'passportNo';

export interface IdType {
  key: IdKey;
  /** Value stored in Customer.IDType. */
  idType: string;
  label: string;
  field: IdField;
  hint: string;
  pattern: RegExp;
  problem: string;
}

export const ID_TYPES: readonly IdType[] = [
  { key: 'GHANA_CARD', idType: 'NATIONAL_ID', label: 'Ghana Card Number', field: 'nationalId', hint: 'GHA-#########-#', pattern: /^GHA-\d{9}-\d$/, problem: 'Ghana Card number must look like GHA-123456789-0.' },
  { key: 'VOTER_ID', idType: 'VOTER_ID', label: 'Voter ID Number', field: 'voterIdNo', hint: 'Number on the voter ID card', pattern: /^[A-Z0-9]{6,15}$/, problem: 'Voter ID should be 6 to 15 letters or digits.' },
  { key: 'NHIS', idType: 'NHIS', label: 'NHIS Card Number', field: 'nhisNo', hint: 'Membership number on the NHIS card', pattern: /^[A-Z0-9][A-Z0-9/-]{5,19}$/, problem: 'NHIS number should be 6 to 20 letters, digits or hyphens.' },
  { key: 'PASSPORT', idType: 'PASSPORT', label: 'Passport Number', field: 'passportNo', hint: 'Passport number', pattern: /^[A-Z0-9]{6,12}$/, problem: 'Passport number should be 6 to 12 letters or digits.' },
];

export const MISSING_ID_MESSAGE = 'Enter at least one ID: Ghana Card, voter ID, NHIS card or passport.';

/** Keeps the digits typed and lays them out as GHA-#########-#. */
export function formatGhanaCard(raw: string): string {
  const digits = raw
    .toUpperCase()
    .replace(/^\s*GHA/, '')
    .replace(/\D/g, '')
    .slice(0, 10);
  if (!digits) return '';
  const head = digits.slice(0, 9);
  const check = digits.slice(9, 10);
  return `GHA-${head}${check ? `-${check}` : ''}`;
}

/** Upper-case and strip spaces; the Ghana Card also gets its hyphens laid out. */
export function normaliseIdNumber(key: IdKey, value: string): string {
  return key === 'GHANA_CARD' ? formatGhanaCard(value) : value.toUpperCase().replace(/\s+/g, '');
}

export function idNumberProblem(type: IdType, value: string): string | null {
  const text = value.trim().toUpperCase();
  if (!text) return null;
  return type.pattern.test(text) ? null : type.problem;
}

// ---- field rules --------------------------------------------------------

/** Ghana phone: +233######### or 0#########. */
export const isGhanaPhone = (value: string): boolean => /^(\+233\d{9}|0\d{9})$/.test(value.replace(/\s|-/g, ''));
export const isEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
/** At least two name parts: letters with spaces, hyphens and apostrophes. */
export const isFullName = (value: string): boolean => {
  const v = value.trim();
  return v.length >= 3 && /^[A-Za-z][A-Za-z\-']*(\s+[A-Za-z][A-Za-z\-']*)+$/.test(v);
};
export const isAlphabetic = (value: string): boolean => /^[A-Za-z\s]+$/.test(value);

/** 0XXXXXXXXX, whichever way the number was typed. */
export function localPhone(value: string): string {
  const compact = value.replace(/[\s-]/g, '');
  return compact.startsWith('+233') ? `0${compact.slice(4)}` : compact;
}

export const MINOR_AGE = 18;

function parseIsoDate(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

/** Age in whole years on the given day, or null when the date is not a real date. */
export function ageOn(birthDate: string, today: Date): number | null {
  const b = parseIsoDate(birthDate);
  if (!b) return null;
  let age = today.getUTCFullYear() - b.y;
  const before = today.getUTCMonth() + 1 < b.m || (today.getUTCMonth() + 1 === b.m && today.getUTCDate() < b.d);
  if (before) age -= 1;
  return age;
}

/** "23/04/1990" (day first, as people write it) to "1990-04-23"; '' when not a real date. */
export function parseDisplayDate(text: string): string {
  const m = /^\s*(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{4})\s*$/.exec(text);
  if (!m) return '';
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return parseIsoDate(iso) ? iso : '';
}

export function formatDisplayDate(iso: string): string {
  const b = parseIsoDate(iso);
  return b ? `${String(b.d).padStart(2, '0')}/${String(b.m).padStart(2, '0')}/${b.y}` : '';
}

// ---- the form -----------------------------------------------------------

export interface GuardianForm {
  name: string;
  nationalId: string;
  phone: string;
  relationship: string;
  address: string;
  employer: string;
}

export interface BeneficiaryForm {
  name: string;
  relationship: string;
  phone: string;
  email: string;
  address: string;
  /** Typed as text, so a half-typed number is not lost. */
  percentage: string;
  isMinor: boolean;
  guardianName: string;
  guardianPhone: string;
}

export interface AlertsForm {
  sms: boolean;
  email: boolean;
  transaction: boolean;
  loan: boolean;
  maturity: boolean;
  promotional: boolean;
}

/** Everything the mobilizer types. Dates are YYYY-MM-DD; everything else is text or a switch. */
export interface RegistrationForm {
  // Personal information
  memberType: string;
  title: string;
  firstName: string;
  middleName: string;
  lastName: string;
  birthDate: string;
  sex: string;
  maritalStatus: string;
  registrationNo: string;
  staffNo: string;
  nationalId: string;
  voterIdNo: string;
  nhisNo: string;
  passportNo: string;
  guardian: GuardianForm;
  // Contact information
  phone: string;
  email: string;
  contactValue: string;
  mobileAlert: string;
  allowMarketing: boolean;
  preferredContactTime: string;
  residentialAddress: string;
  addressLine1: string;
  addressLine2: string;
  addressLine3: string;
  landmark: string;
  gpsCoordinates: string;
  region: string;
  city: string;
  // Employment details
  employerName: string;
  jobTitle: string;
  employmentType: string;
  yearsWithEmployer: string;
  employerAddress: string;
  employerContact: string;
  incomeSource: string;
  // Financial details
  customerBank: string;
  customerBranch: string;
  bankAccountNo: string;
  sourceOfFunds: string;
  expectedTransactionVolume: string;
  politicallyExposed: boolean;
  // Beneficiaries and alerts
  beneficiaries: BeneficiaryForm[];
  alerts: AlertsForm;
}

export const EMPTY_GUARDIAN: GuardianForm = { name: '', nationalId: '', phone: '', relationship: '', address: '', employer: '' };

export const EMPTY_BENEFICIARY: BeneficiaryForm = {
  name: '', relationship: '', phone: '', email: '', address: '', percentage: '', isMinor: false, guardianName: '', guardianPhone: '',
};

export const EMPTY_FORM: RegistrationForm = {
  memberType: '', title: '', firstName: '', middleName: '', lastName: '', birthDate: '', sex: '', maritalStatus: '',
  registrationNo: '', staffNo: '', nationalId: '', voterIdNo: '', nhisNo: '', passportNo: '',
  guardian: EMPTY_GUARDIAN,
  phone: '', email: '', contactValue: '', mobileAlert: '', allowMarketing: false, preferredContactTime: '',
  residentialAddress: '', addressLine1: '', addressLine2: '', addressLine3: '', landmark: '', gpsCoordinates: '', region: '', city: '',
  employerName: '', jobTitle: '', employmentType: '', yearsWithEmployer: '', employerAddress: '', employerContact: '', incomeSource: '',
  customerBank: '', customerBranch: '', bankAccountNo: '', sourceOfFunds: '', expectedTransactionVolume: '', politicallyExposed: false,
  beneficiaries: [],
  alerts: { sms: true, email: true, transaction: true, loan: true, maturity: true, promotional: false },
};

export const STEPS = [
  { id: 'personal', label: 'Personal information' },
  { id: 'contact', label: 'Contact information' },
  { id: 'employment', label: 'Employment details' },
  { id: 'financial', label: 'Financial details' },
  { id: 'beneficiaries', label: 'Beneficiaries' },
  { id: 'alerts', label: 'Alert preferences' },
  { id: 'preview', label: 'Preview and submit' },
] as const;
export type StepId = (typeof STEPS)[number]['id'];

/** True when a guardian is needed: under 18, or a member type that always has one. */
export function needsGuardian(form: Pick<RegistrationForm, 'birthDate' | 'memberType'>, types: MemberTypeOption[], today: Date): boolean {
  if (types.find((t) => t.code === form.memberType)?.guardianRequired) return true;
  const age = ageOn(form.birthDate, today);
  return age !== null && age < MINOR_AGE;
}

export interface FormProblem {
  /** The field to highlight, when the problem belongs to one. */
  field?: string;
  message: string;
}

/**
 * The checks the core app's registration form makes before it moves on, in the same words.
 * An empty list means the step is complete.
 */
export function validateStep(step: StepId, form: RegistrationForm, types: MemberTypeOption[], today: Date): FormProblem[] {
  const errors: FormProblem[] = [];
  const required = (v: string) => v.trim() !== '';

  if (step === 'personal') {
    if (!required(form.memberType)) errors.push({ field: 'memberType', message: 'Member Type is required' });
    if (!required(form.firstName)) errors.push({ field: 'firstName', message: 'First Name is required' });
    else if (!isAlphabetic(form.firstName)) errors.push({ field: 'firstName', message: 'First Name can only have letters' });
    if (!required(form.lastName)) errors.push({ field: 'lastName', message: 'Last Name is required' });
    else if (!isAlphabetic(form.lastName)) errors.push({ field: 'lastName', message: 'Last Name can only have letters' });
    if (required(form.middleName) && !isAlphabetic(form.middleName)) errors.push({ field: 'middleName', message: 'Middle Name can only have letters' });
    const age = form.birthDate ? ageOn(form.birthDate, today) : null;
    if (!form.birthDate) errors.push({ field: 'birthDate', message: 'Date of Birth is required' });
    else if (age === null) errors.push({ field: 'birthDate', message: 'Invalid Date of Birth' });
    else if (form.birthDate > today.toISOString().slice(0, 10)) errors.push({ field: 'birthDate', message: 'Date of Birth cannot be in the future' });
    else if (needsGuardian(form, types, today)) {
      const g = form.guardian;
      if (!required(g.name)) errors.push({ field: 'guardian.name', message: 'Guardian information required for minor accounts' });
      else {
        if (!required(g.nationalId)) errors.push({ field: 'guardian.nationalId', message: 'Guardian ID number is required (Ghana Card, voter ID, NHIS or passport)' });
        if (!required(g.phone) || !isGhanaPhone(g.phone)) errors.push({ field: 'guardian.phone', message: 'Guardian phone number is required and must be valid' });
      }
    }
    if (!required(form.sex)) errors.push({ field: 'sex', message: 'Gender is required' });
    let anyId = false;
    for (const type of ID_TYPES) {
      const value = form[type.field];
      if (required(value)) anyId = true;
      const problem = idNumberProblem(type, value);
      if (problem) errors.push({ field: type.field, message: problem });
    }
    if (!anyId) errors.push({ field: 'ids', message: MISSING_ID_MESSAGE });
  }

  if (step === 'contact') {
    if (!required(form.phone) || !isGhanaPhone(form.phone)) errors.push({ field: 'phone', message: 'Invalid primary phone number' });
    if (required(form.email) && !isEmail(form.email)) errors.push({ field: 'email', message: 'Invalid email address format' });
    if (required(form.mobileAlert) && !isGhanaPhone(form.mobileAlert)) errors.push({ field: 'mobileAlert', message: 'Invalid mobile alert number' });
    if (!required(form.residentialAddress)) errors.push({ field: 'residentialAddress', message: 'Residential Address is required' });
    if (!required(form.region)) errors.push({ field: 'region', message: 'Region is required' });
    if (!required(form.city)) errors.push({ field: 'city', message: 'City is required' });
  }

  if (step === 'employment') {
    if (required(form.yearsWithEmployer) && !/^\d+(\.\d{1,2})?$/.test(form.yearsWithEmployer.trim())) {
      errors.push({ field: 'yearsWithEmployer', message: 'Years with Employer must be a number' });
    }
  }

  if (step === 'beneficiaries') {
    const total = beneficiaryTotal(form.beneficiaries);
    if (Math.round(total * 1000) !== 100_000) errors.push({ field: 'beneficiaries', message: `Beneficiaries must total 100% (current ${total}%)` });
    form.beneficiaries.forEach((b, i) => {
      if (b.isMinor) {
        if (!required(b.guardianName)) errors.push({ field: `beneficiaries.${i}.guardianName`, message: `Beneficiary ${i + 1}: guardian name required` });
        if (!required(b.guardianPhone) || !isGhanaPhone(b.guardianPhone)) errors.push({ field: `beneficiaries.${i}.guardianPhone`, message: `Beneficiary ${i + 1}: invalid guardian phone` });
      }
      if (!isFullName(b.name)) errors.push({ field: `beneficiaries.${i}.name`, message: `Beneficiary ${i + 1}: full name must include at least two names` });
    });
  }
  return errors;
}

/** Every step's problems, in step order. */
export function validateAll(form: RegistrationForm, types: MemberTypeOption[], today: Date): { step: StepId; problems: FormProblem[] }[] {
  return STEPS.map((s) => ({ step: s.id, problems: validateStep(s.id, form, types, today) })).filter((r) => r.problems.length > 0);
}

export function beneficiaryTotal(list: BeneficiaryForm[]): number {
  const total = list.reduce((sum, b) => sum + (Number.parseFloat(b.percentage) || 0), 0);
  return Math.round(total * 1000) / 1000;
}

/** Lines for the "add the remaining %" hint when adding a beneficiary. */
export function remainingPercentage(list: BeneficiaryForm[]): number {
  return Math.max(0, Math.round((100 - beneficiaryTotal(list)) * 1000) / 1000);
}

// ---- what is stored and sent --------------------------------------------

/** The registration as the server takes it (POST /v1/registrations). */
export interface RegistrationPayload {
  localRegistrationId: string;
  capturedAt: string;
  memberType: string;
  title: string;
  firstName: string;
  middleName: string;
  lastName: string;
  birthDate: string;
  sex: string;
  maritalStatus: string;
  registrationNo: string;
  staffNo: string;
  nationalId: string;
  voterIdNo: string;
  nhisNo: string;
  passportNo: string;
  guardian: GuardianForm | null;
  phone: string;
  email: string;
  contactValue: string;
  mobileAlert: string;
  allowMarketing: boolean;
  preferredContactTime: string;
  residentialAddress: string;
  addressLine1: string;
  addressLine2: string;
  addressLine3: string;
  landmark: string;
  gpsCoordinates: string;
  region: string;
  city: string;
  employerName: string;
  jobTitle: string;
  employmentType: string;
  yearsWithEmployer: string;
  employerAddress: string;
  employerContact: string;
  incomeSource: string;
  customerBank: string;
  customerBranch: string;
  bankAccountNo: string;
  sourceOfFunds: string;
  expectedTransactionVolume: string;
  politicallyExposed: boolean;
  beneficiaries: {
    name: string;
    relationship: string;
    phone: string;
    email: string;
    address: string;
    percentage: number;
    isMinor: boolean;
    guardianName: string;
    guardianPhone: string;
  }[];
  alerts: AlertsForm;
}

const trim = (s: string) => s.trim();

/** Tidies the form into what the server takes: trimmed text, upper-cased IDs, numbers as numbers. */
export function toPayload(form: RegistrationForm, localRegistrationId: string, capturedAt: string, types: MemberTypeOption[], today: Date): RegistrationPayload {
  const guardian = needsGuardian(form, types, today) || form.guardian.name.trim() !== '' ? { ...form.guardian, nationalId: form.guardian.nationalId.trim().toUpperCase() } : null;
  return {
    localRegistrationId,
    capturedAt,
    memberType: trim(form.memberType),
    title: trim(form.title),
    firstName: trim(form.firstName),
    middleName: trim(form.middleName),
    lastName: trim(form.lastName),
    birthDate: trim(form.birthDate),
    sex: trim(form.sex),
    maritalStatus: trim(form.maritalStatus),
    registrationNo: trim(form.registrationNo),
    staffNo: trim(form.staffNo),
    nationalId: normaliseIdNumber('GHANA_CARD', form.nationalId),
    voterIdNo: normaliseIdNumber('VOTER_ID', form.voterIdNo),
    nhisNo: normaliseIdNumber('NHIS', form.nhisNo),
    passportNo: normaliseIdNumber('PASSPORT', form.passportNo),
    guardian: guardian ? Object.fromEntries(Object.entries(guardian).map(([k, v]) => [k, trim(String(v))])) as unknown as GuardianForm : null,
    phone: trim(form.phone),
    email: trim(form.email),
    contactValue: trim(form.contactValue),
    mobileAlert: trim(form.mobileAlert),
    allowMarketing: form.allowMarketing,
    preferredContactTime: trim(form.preferredContactTime),
    residentialAddress: trim(form.residentialAddress),
    addressLine1: trim(form.addressLine1),
    addressLine2: trim(form.addressLine2),
    addressLine3: trim(form.addressLine3),
    landmark: trim(form.landmark),
    gpsCoordinates: trim(form.gpsCoordinates),
    region: trim(form.region),
    city: trim(form.city),
    employerName: trim(form.employerName),
    jobTitle: trim(form.jobTitle),
    employmentType: trim(form.employmentType),
    yearsWithEmployer: trim(form.yearsWithEmployer),
    employerAddress: trim(form.employerAddress),
    employerContact: trim(form.employerContact),
    incomeSource: trim(form.incomeSource),
    customerBank: trim(form.customerBank),
    customerBranch: trim(form.customerBranch),
    bankAccountNo: trim(form.bankAccountNo),
    sourceOfFunds: trim(form.sourceOfFunds),
    expectedTransactionVolume: trim(form.expectedTransactionVolume),
    politicallyExposed: form.politicallyExposed,
    beneficiaries: form.beneficiaries.map((b) => ({
      name: trim(b.name),
      relationship: trim(b.relationship),
      phone: trim(b.phone),
      email: trim(b.email),
      address: trim(b.address),
      percentage: Number.parseFloat(b.percentage) || 0,
      isMinor: b.isMinor,
      guardianName: trim(b.guardianName),
      guardianPhone: trim(b.guardianPhone),
    })),
    alerts: { ...form.alerts },
  };
}

/** The first ID given, in the fixed order, as the stored ID type. */
export function primaryId(p: Pick<RegistrationPayload, IdField>): { type: IdType; value: string } | null {
  for (const type of ID_TYPES) {
    const value = p[type.field];
    if (value) return { type, value };
  }
  return null;
}

/** A registration saved on this phone, waiting to be delivered. */
export interface RegistrationItem {
  localRegistrationId: string;
  firstName: string;
  lastName: string;
  gender: 'F' | 'M';
  dateOfBirth: string;
  /** As typed on the form. */
  phone: string;
  /** The first ID given: its stored type. */
  idType: string;
  idNumber: string;
  address: string;
  /** ISO time on the device when the form was saved. */
  capturedAt: string;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  /** The new member's number, once the core system has received the registration. */
  serverId: string | null;
  createdAt: string;
  /** The whole form as sent to the server. Null for a registration saved by an older version of the app. */
  payload: RegistrationPayload | null;
}

export const fullName = (r: Pick<RegistrationItem, 'firstName' | 'lastName'>) => `${r.firstName} ${r.lastName}`;
