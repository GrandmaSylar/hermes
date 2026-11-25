import type { Repos } from '@/data/repositories';
import {
  ID_TYPES,
  primaryId,
  toPayload,
  validateAll,
  type FormProblem,
  type MemberTypeOption,
  type RegistrationForm,
  type RegistrationItem,
  type StepId,
} from '@/domain/registration';
import type { Session } from '@/domain/types';

export type RegisterResult =
  | { ok: true; item: RegistrationItem }
  | { ok: false; step?: StepId; problems: FormProblem[]; message?: string };

/**
 * Saves a member registration to the on-device outbox. Like a collection, it is safe on the phone
 * the moment this returns and is delivered later by the sync engine. The new member is pending
 * until the office approves them.
 */
export async function registerMember(
  repos: Repos,
  session: Session,
  form: RegistrationForm,
  types: MemberTypeOption[],
  newId: () => string,
  now: () => Date = () => new Date(),
): Promise<RegisterResult> {
  const today = now();
  const failed = validateAll(form, types, today);
  if (failed.length > 0) return { ok: false, step: failed[0].step, problems: failed[0].problems };

  const stamp = today.toISOString();
  const payload = toPayload(form, newId(), stamp, types, today);

  // The office checks this too. Catching it here saves a wasted trip and a rejection later.
  for (const type of ID_TYPES) {
    const value = payload[type.field];
    if (value && (await repos.registrations.hasIdNumber(value))) {
      return {
        ok: false,
        step: 'personal',
        problems: [{ field: type.field, message: `${type.label} ${value} is already in a registration saved on this phone.` }],
      };
    }
  }
  if ((await repos.registrations.waitingCount()) >= session.limits.maxUnsyncedItems) {
    return {
      ok: false,
      problems: [],
      message: 'Too many items are waiting to sync. Connect to the network and sync before registering more members.',
    };
  }

  const id = primaryId(payload);
  const item: Omit<RegistrationItem, 'status' | 'attempts' | 'lastError' | 'serverId'> = {
    localRegistrationId: payload.localRegistrationId,
    firstName: payload.firstName,
    lastName: payload.lastName,
    gender: payload.sex === 'Female' ? 'F' : 'M',
    dateOfBirth: payload.birthDate,
    phone: payload.phone,
    idType: id?.type.idType ?? '',
    idNumber: id?.value ?? '',
    address: payload.residentialAddress,
    capturedAt: stamp,
    createdAt: stamp,
    payload,
  };
  await repos.registrations.enqueue(item);
  return { ok: true, item: { ...item, status: 'PENDING', attempts: 0, lastError: null, serverId: null } };
}
