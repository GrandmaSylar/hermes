import type { Repos } from '@/data/repositories';
import {
  normaliseIdNumber,
  normalisePhone,
  validateRegistration,
  type Gender,
  type IdType,
  type RegistrationDraft,
  type RegistrationErrors,
  type RegistrationItem,
} from '@/domain/registration';
import type { Session } from '@/domain/types';

export type RegisterResult =
  | { ok: true; item: RegistrationItem }
  | { ok: false; errors: RegistrationErrors; message?: string };

/**
 * Saves a member registration to the on-device outbox. Like a collection, it is
 * safe on the phone the moment this returns and is delivered later by the sync
 * engine. The new member gets no member number and cannot transact until the
 * office approves the draft.
 */
export async function registerMember(
  repos: Repos,
  session: Session,
  draft: RegistrationDraft,
  newId: () => string,
  now: () => Date = () => new Date(),
): Promise<RegisterResult> {
  const errors = validateRegistration(draft, now());
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const idNumber = normaliseIdNumber(draft.idNumber);
  // The office also checks this. Catching it here saves a wasted trip and a rejection later.
  if (await repos.registrations.hasIdNumber(idNumber)) {
    return {
      ok: false,
      errors: { idNumber: 'This ID number is already registered on this phone.' },
    };
  }
  if ((await repos.registrations.waitingCount()) >= session.limits.maxUnsyncedItems) {
    return {
      ok: false,
      errors: {},
      message: 'Too many items are waiting to sync. Connect to the network and sync before registering more members.',
    };
  }

  const stamp = now().toISOString();
  const item = {
    localRegistrationId: newId(),
    firstName: draft.firstName.trim(),
    lastName: draft.lastName.trim(),
    gender: draft.gender as Gender,
    dateOfBirth: draft.dateOfBirth.trim(),
    phone: normalisePhone(draft.phone) as string,
    idType: draft.idType as IdType,
    idNumber,
    address: draft.address.trim(),
    capturedAt: stamp,
    createdAt: stamp,
  };
  await repos.registrations.enqueue(item);
  return { ok: true, item: { ...item, status: 'PENDING', attempts: 0, lastError: null, serverId: null } };
}
