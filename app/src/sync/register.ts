import type { FileStore } from '@/data/files';
import type { Repos } from '@/data/repositories';
import {
  ID_TYPES,
  KYC_SLOTS,
  type KycFile,
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
  files?: FileStore,
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

  // The chosen pictures move into the app's own storage, so they are still there when the phone syncs.
  const chosen = KYC_SLOTS.map((s) => form.documents[s.kind]).filter((f): f is KycFile => !!f);
  const kept: KycFile[] = [];
  if (chosen.length > 0) {
    if (!files) return { ok: false, problems: [], message: 'This phone cannot keep the pictures. Remove them or update the app.' };
    try {
      for (const f of chosen) {
        const extension = f.mimeType === 'application/pdf' ? 'pdf' : f.mimeType === 'image/png' ? 'png' : f.mimeType === 'image/gif' ? 'gif' : 'jpg';
        kept.push({ ...f, uri: await files.keep(f.uri, payload.localRegistrationId, f.kind, extension) });
      }
    } catch {
      await Promise.all(kept.map((k) => files.remove(k.uri).catch(() => undefined)));
      return { ok: false, problems: [], message: 'The pictures could not be saved on this phone. Check that there is free space and try again.' };
    }
  }

  const id = primaryId(payload);
  const item: Omit<RegistrationItem, 'status' | 'attempts' | 'lastError' | 'serverId' | 'files'> & { files: KycFile[] } = {
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
    files: kept,
  };
  try {
    await repos.registrations.enqueue(item);
  } catch (error) {
    if (files) await Promise.all(kept.map((k) => files.remove(k.uri).catch(() => undefined)));
    throw error;
  }
  return {
    ok: true,
    item: {
      ...item,
      status: 'PENDING',
      attempts: 0,
      lastError: null,
      serverId: null,
      files: kept.map((f) => ({ ...f, status: 'PENDING', attempts: 0, lastError: null })),
    },
  };
}
