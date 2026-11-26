import type { ServerDeposit, ServerRegistration } from '@/data/api/contract';
import type { ImportedDeposit, ImportedRegistration, KvRepo, Repos } from '@/data/repositories';
import type { OfficeStatus, ProductType } from '@/domain/types';

/**
 * Keeping the officer's own data with the officer, not the phone: favourite members, and the deposits and members
 * they have captured before. The server holds the truth; a phone is a cache that fills itself on sign-in.
 */

// ---- favourites ----------------------------------------------------------------------------------------------

/** Changes made while offline, waiting to reach the server: member number to whether it is now a favourite. */
export const KV_FAVORITES_PENDING = 'favorites.pending';
/** Set once this phone's own favourites have been offered to the server (they may pre-date the server list). */
export const KV_FAVORITES_OFFERED = 'favorites.offered';

export async function readPendingFavorites(kv: KvRepo): Promise<Record<string, boolean>> {
  try {
    const parsed = JSON.parse((await kv.get(KV_FAVORITES_PENDING)) ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean>;
  } catch {
    return {};
  }
}

/** Marks a member as a favourite (or not) on this phone and remembers to tell the server. The latest choice for a member wins. */
export async function setFavorite(repos: Repos, memberCode: string, on: boolean): Promise<void> {
  await repos.members.setMyCustomer(memberCode, on);
  const pending = await readPendingFavorites(repos.kv);
  pending[memberCode] = on;
  await repos.kv.set(KV_FAVORITES_PENDING, JSON.stringify(pending));
}

interface FavoriteApi {
  pullFavorites(): Promise<string[]>;
  setFavorite(memberCode: string, on: boolean): Promise<void>;
}

/**
 * Sends waiting favourite changes, offers this phone's older favourites once, then makes the phone match the
 * server. A change that cannot be sent (no network) stops the run and stays waiting, so nothing is lost and the
 * server's older list never overwrites a choice made offline.
 */
export async function syncFavorites(repos: Repos, api: FavoriteApi): Promise<void> {
  const pending = await readPendingFavorites(repos.kv);
  for (const [code, on] of Object.entries(pending)) {
    await api.setFavorite(code, on);
    delete pending[code];
    await repos.kv.set(KV_FAVORITES_PENDING, JSON.stringify(pending));
  }

  let server = await api.pullFavorites();
  if ((await repos.kv.get(KV_FAVORITES_OFFERED)) === null) {
    const known = new Set(server);
    for (const code of await repos.members.favoriteCodes()) {
      if (!known.has(code)) {
        await api.setFavorite(code, true);
        server = [...server, code];
      }
    }
    await repos.kv.set(KV_FAVORITES_OFFERED, '1');
  }
  await repos.members.setFavorites(server);
}

// ---- activity ------------------------------------------------------------------------------------------------

const OFFICE_STATUS: Record<string, OfficeStatus> = { PENDING: 'PENDING', APPROVED: 'APPROVED', VERIFIED: 'VERIFIED', REJECTED: 'REJECTED' };

/** A server deposit as an item for the phone's history, or null when it is not one the app knows how to show. */
export function toImportedDeposit(d: ServerDeposit, memberName: string | null): ImportedDeposit | null {
  const officeStatus = OFFICE_STATUS[d.status];
  if (!officeStatus || !d.localTransactionId || !d.memberCode || !d.createdAt) return null;
  const productType: ProductType = d.kind === 'SHARES' ? 'SHARE_CONTRIBUTION' : 'SAVINGS_DEPOSIT';
  return {
    localTransactionId: d.localTransactionId,
    memberCode: d.memberCode,
    memberName: memberName ?? `Member ${d.memberCode}`,
    productType,
    amount: d.amount,
    collectedAt: d.createdAt,
    serverId: d.serverId,
    officeStatus,
    officeReason: officeStatus === 'REJECTED' ? d.reason : null,
    officeDecidedAt: d.decidedAt,
  };
}

export function toImportedRegistration(r: ServerRegistration): ImportedRegistration | null {
  if (!r.memberCode || !r.createdAt) return null;
  return {
    serverId: r.memberCode,
    firstName: r.firstName || 'Member',
    lastName: r.lastName || r.memberCode,
    gender: r.sex.trim().toUpperCase().startsWith('M') ? 'M' : 'F',
    dateOfBirth: r.birthDate ?? '',
    phone: r.phone,
    capturedAt: r.createdAt,
  };
}
