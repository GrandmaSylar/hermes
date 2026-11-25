/**
 * The core's idempotency index on SavingsTransaction only covers references that start
 * with this prefix, so every deposit the server writes (savings and shares) carries it.
 * Rows written before the prefix existed hold the bare id, so lookups try both forms.
 */
export const REF_PREFIX = 'MOBIDEMP-';

/** ReferenceNumber is varchar(50): 50 - 9 = 41 characters left for the app's id. */
export const MAX_LOCAL_ID = 41;

export function storedReference(localId: string): string {
  return REF_PREFIX + localId;
}

/** The app's id back out of a stored reference (either form). */
export function originalReference(stored: string): string {
  return stored.startsWith(REF_PREFIX) ? stored.slice(REF_PREFIX.length) : stored;
}
