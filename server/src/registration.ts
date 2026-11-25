import { z } from 'zod';

/**
 * Member registration rules, copied from the core banking app's registration form
 * (CustomerOnboarding, memberIdentification, memberTypeRules) so a member registered in the
 * field passes exactly the checks a member registered at the office does.
 *
 * Individual members only: Individual, Youth, Kiddy and Student member types.
 */

// ---- member types ------------------------------------------------------

/** Member types whose registration collects an individual's own details (accountType INDIVIDUAL). */
const NON_INDIVIDUAL_TYPES = new Set(['JNT', 'GRP', 'ORG', 'CORP']);

/** A Kiddy Savings member is a minor whatever the birth date says. */
const GUARDIAN_ALWAYS_TYPES = new Set(['KID']);

/** Youth savings, kiddy savings and student members are approved without a share deposit. */
const SHARE_EXEMPT = new Set(['YTH', 'KID', 'STD']);

export const memberTypeIsIndividual = (code: string): boolean => !NON_INDIVIDUAL_TYPES.has(code.trim().toUpperCase());
export const memberTypeRequiresGuardian = (code: string): boolean => GUARDIAN_ALWAYS_TYPES.has(code.trim().toUpperCase());
export const memberTypeSharesOptional = (code: string): boolean => SHARE_EXEMPT.has(code.trim().toUpperCase());

// ---- identification ----------------------------------------------------

export type IdKey = 'GHANA_CARD' | 'VOTER_ID' | 'NHIS' | 'PASSPORT';

export interface IdType {
  key: IdKey;
  /** Value stored in Customer.IDType. The Ghana Card keeps its older name. */
  idType: string;
  label: string;
  field: 'nationalId' | 'voterIdNo' | 'nhisNo' | 'passportNo';
  column: 'NationalID' | 'VoterIDNo' | 'NHISNo' | 'PassportNo';
  pattern: RegExp;
  problem: string;
}

export const ID_TYPES: readonly IdType[] = [
  { key: 'GHANA_CARD', idType: 'NATIONAL_ID', label: 'Ghana Card', field: 'nationalId', column: 'NationalID', pattern: /^GHA-\d{9}-\d$/, problem: 'Ghana Card number must look like GHA-123456789-0.' },
  { key: 'VOTER_ID', idType: 'VOTER_ID', label: 'Voter ID', field: 'voterIdNo', column: 'VoterIDNo', pattern: /^[A-Z0-9]{6,15}$/, problem: 'Voter ID should be 6 to 15 letters or digits.' },
  { key: 'NHIS', idType: 'NHIS', label: 'NHIS card', field: 'nhisNo', column: 'NHISNo', pattern: /^[A-Z0-9][A-Z0-9/-]{5,19}$/, problem: 'NHIS number should be 6 to 20 letters, digits or hyphens.' },
  { key: 'PASSPORT', idType: 'PASSPORT', label: 'Passport', field: 'passportNo', column: 'PassportNo', pattern: /^[A-Z0-9]{6,12}$/, problem: 'Passport number should be 6 to 12 letters or digits.' },
];

export const MISSING_ID_MESSAGE = 'Enter at least one ID: Ghana Card, voter ID, NHIS card or passport.';

/** Keeps whatever digits were typed and lays them out as GHA-#########-#. */
export function formatGhanaCard(raw: unknown): string {
  const digits = String(raw ?? '')
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
export function normaliseIdNumber(key: IdKey, value: unknown): string {
  if (key === 'GHANA_CARD') return formatGhanaCard(value);
  return String(value ?? '').toUpperCase().replace(/\s+/g, '');
}

export function idNumberProblem(type: IdType, value: string): string | null {
  const text = value.trim().toUpperCase();
  if (!text) return null;
  return type.pattern.test(text) ? null : type.problem;
}

export interface IdValues {
  nationalId?: string;
  voterIdNo?: string;
  nhisNo?: string;
  passportNo?: string;
}

/** The IDs that were filled in, in the fixed order above. */
export function collectIds(values: IdValues): { type: IdType; value: string }[] {
  const found: { type: IdType; value: string }[] = [];
  for (const type of ID_TYPES) {
    const value = String(values[type.field] ?? '').trim().toUpperCase();
    if (value) found.push({ type, value });
  }
  return found;
}

/** The Customer.IDType to store: the first ID present, in the order above. */
export function primaryIdType(values: IdValues): string | null {
  return collectIds(values)[0]?.type.idType ?? null;
}

// ---- field rules -------------------------------------------------------

/** Ghana phone: +233######### or 0#########. */
export const isGhanaPhone = (value: string): boolean => /^(\+233\d{9}|0\d{9})$/.test(value.replace(/\s|-/g, ''));
export const isEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
/** At least two name parts, letters with spaces, hyphens and apostrophes. */
export const isFullName = (value: string): boolean => {
  const v = value.trim();
  if (v.length < 3) return false;
  return /^[A-Za-z][A-Za-z\-']*(\s+[A-Za-z][A-Za-z\-']*)+$/.test(v);
};

/** Compact comparable form of a phone number: 0XXXXXXXXX. */
export function localPhone(value: string): string {
  const compact = value.replace(/[\s-]/g, '');
  if (compact.startsWith('+233')) return `0${compact.slice(4)}`;
  return compact;
}

export const MINOR_AGE = 18;

export function ageOn(birthDate: string, today: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const born = new Date(Date.UTC(y, mo - 1, d));
  if (born.getUTCFullYear() !== y || born.getUTCMonth() !== mo - 1 || born.getUTCDate() !== d) return null;
  let age = today.getUTCFullYear() - y;
  const beforeBirthday = today.getUTCMonth() + 1 < mo || (today.getUTCMonth() + 1 === mo && today.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

// ---- the request -------------------------------------------------------

const text = (max: number) => z.string().trim().max(max).optional().default('');
const flag = z.boolean().optional().default(false);

const guardianSchema = z.object({
  name: z.string().trim().max(200),
  nationalId: z.string().trim().max(30).optional().default(''),
  phone: z.string().trim().max(50).optional().default(''),
  relationship: text(50),
  address: text(200),
  employer: text(200),
});

const beneficiarySchema = z.object({
  name: z.string().trim().max(30),
  relationship: z.string().trim().max(30),
  phone: text(50),
  email: text(100),
  address: text(30),
  percentage: z.number().min(0).max(100),
  isMinor: flag,
  guardianName: text(200),
  guardianPhone: text(50),
});

export const registrationBody = z.object({
  localRegistrationId: z.string().trim().min(8).max(100),
  capturedAt: z.string().datetime({ offset: true }),

  // Personal information
  memberType: z.string().trim().min(1, 'Member Type is required').max(20),
  title: text(20),
  firstName: z.string().trim().max(50),
  middleName: text(50),
  lastName: z.string().trim().max(50),
  birthDate: z.string().trim(),
  sex: z.string().trim(),
  maritalStatus: text(15),
  registrationNo: text(30),
  staffNo: text(20),
  nationalId: text(30),
  voterIdNo: text(30),
  nhisNo: text(30),
  passportNo: text(30),
  guardian: guardianSchema.nullable().optional(),

  // Contact information
  phone: z.string().trim().max(50),
  email: text(150),
  contactValue: z.string().trim().max(200),
  mobileAlert: text(50),
  allowMarketing: flag,
  preferredContactTime: text(50),
  residentialAddress: z.string().trim().max(200),
  addressLine1: text(200),
  addressLine2: text(200),
  addressLine3: text(200),
  landmark: text(200),
  gpsCoordinates: text(50),
  region: z.string().trim().max(100),
  city: z.string().trim().max(100),

  // Employment details
  employerName: text(50),
  jobTitle: text(100),
  employmentType: text(20),
  yearsWithEmployer: text(10),
  employerAddress: text(80),
  employerContact: text(50),
  incomeSource: text(200),

  // Financial details
  customerBank: text(100),
  customerBranch: text(100),
  bankAccountNo: text(50),
  sourceOfFunds: text(50),
  expectedTransactionVolume: text(50),
  politicallyExposed: flag,

  beneficiaries: z.array(beneficiarySchema).max(20).optional().default([]),

  // Alert preferences
  alerts: z
    .object({
      sms: z.boolean().optional().default(true),
      email: z.boolean().optional().default(true),
      transaction: z.boolean().optional().default(true),
      loan: z.boolean().optional().default(true),
      maturity: z.boolean().optional().default(true),
      promotional: z.boolean().optional().default(false),
    })
    .optional()
    .default({}),
});

export type RegistrationBody = z.infer<typeof registrationBody>;

/**
 * The checks the registration form makes before it lets a member be submitted, in the same words.
 * Returns every problem found; an empty list means the registration may go ahead.
 */
export function registrationProblems(body: RegistrationBody, today: Date): string[] {
  const errors: string[] = [];
  const required = (value: string) => value.trim() !== '';

  // Personal information
  if (!required(body.firstName)) errors.push('First Name is required');
  if (!required(body.lastName)) errors.push('Last Name is required');
  const age = body.birthDate ? ageOn(body.birthDate, today) : null;
  if (!body.birthDate) {
    errors.push('Date of Birth is required');
  } else if (age === null) {
    errors.push('Invalid Date of Birth');
  } else if (body.birthDate > today.toISOString().slice(0, 10)) {
    errors.push('Date of Birth cannot be in the future');
  } else if (age < MINOR_AGE || memberTypeRequiresGuardian(body.memberType)) {
    const g = body.guardian;
    if (!g || !required(g.name)) errors.push('Guardian information required for minor accounts');
    else {
      if (!required(g.nationalId)) errors.push('Guardian ID number is required (Ghana Card, voter ID, NHIS or passport)');
      if (!required(g.phone) || !isGhanaPhone(g.phone)) errors.push('Guardian phone number is required and must be valid');
    }
  }
  if (!required(body.sex)) errors.push('Gender is required');
  else if (body.sex !== 'Male' && body.sex !== 'Female') errors.push('Gender must be Male or Female');

  // Any one of the four IDs; each one given must be well formed.
  const ids: IdValues = { nationalId: body.nationalId, voterIdNo: body.voterIdNo, nhisNo: body.nhisNo, passportNo: body.passportNo };
  for (const type of ID_TYPES) {
    const problem = idNumberProblem(type, String(ids[type.field] ?? ''));
    if (problem) errors.push(problem);
  }
  if (collectIds(ids).length === 0) errors.push(MISSING_ID_MESSAGE);

  if (!memberTypeIsIndividual(body.memberType)) {
    errors.push('Only individual members can be registered from the field.');
  }

  // Contact information
  if (!required(body.phone) || !isGhanaPhone(body.phone)) errors.push('Invalid primary phone number');
  if (body.email && !isEmail(body.email)) errors.push('Invalid email address format');
  if (body.mobileAlert && !isGhanaPhone(body.mobileAlert)) errors.push('Invalid mobile alert number');
  if (!required(body.residentialAddress)) errors.push('Residential Address is required');
  if (!required(body.region)) errors.push('Region is required');
  if (!required(body.city)) errors.push('City is required');
  if (!required(body.contactValue)) errors.push('Contact Value is required');

  // Employment
  if (body.yearsWithEmployer && !/^\d+(\.\d{1,2})?$/.test(body.yearsWithEmployer)) errors.push('Years with Employer must be a number');

  // Beneficiaries must total 100% (so at least one is needed); a minor beneficiary needs a guardian and phone.
  const total = body.beneficiaries.reduce((sum, x) => sum + (x.percentage || 0), 0);
  if (Math.round(total * 1000) !== 100_000) errors.push(`Beneficiaries must total 100% (current ${total}%)`);
  body.beneficiaries.forEach((b, i) => {
    if (b.isMinor) {
      if (!required(b.guardianName)) errors.push(`Beneficiary ${i + 1}: guardian name required`);
      if (!required(b.guardianPhone) || !isGhanaPhone(b.guardianPhone)) errors.push(`Beneficiary ${i + 1}: invalid guardian phone`);
    }
    if (!isFullName(b.name)) errors.push(`Beneficiary ${i + 1}: full name must include at least two names`);
  });

  return errors;
}
