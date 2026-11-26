import { EMPTY_FORM, type RegistrationForm } from '@/domain/registration';

/** A saved beneficiary row, for tests. */
export const ben = (name: string, percentage: string, over: Record<string, unknown> = {}) => ({
  name,
  relationship: 'Spouse',
  phone: '',
  email: '',
  address: '',
  percentage,
  isMinor: false,
  guardianName: '',
  guardianPhone: '',
  ...over,
});

/** A complete adult registration. Tests change one thing at a time. */
export const validForm = (over: Partial<RegistrationForm> = {}): RegistrationForm => ({
  ...EMPTY_FORM,
  memberType: 'IND',
  firstName: 'Samuel',
  lastName: 'Akuffo',
  birthDate: '1990-01-01',
  sex: 'Male',
  nationalId: 'GHA-123456789-0',
  phone: '0244123456',
  residentialAddress: 'House 4, Kasoa',
  region: 'Central',
  city: 'Kasoa',
  beneficiaries: [ben('Ama Akuffo', '100')],
  ...over,
});

