/** The database file from before each officer had their own. The first officer found signed in keeps it. */
export const LEGACY_DB_NAME = 'qss.db';
/** Which database file belongs to which officer. */
export type DbMap = Record<string, string>;

/**
 * The file for an officer, and the updated map. Every officer gets a file of their own, so what is cached on a
 * phone (favourites, history, balances, unsent items) belongs to one account and never leaks into another's.
 * `adoptLegacy` lets the officer who was already signed in before this change keep the old file, so nothing
 * waiting to sync is lost by updating.
 */
export function pickDbName(map: DbMap, officerId: string, adoptLegacy: boolean): { name: string; map: DbMap } {
  const known = map[officerId];
  if (known) return { name: known, map };
  const name = adoptLegacy && Object.keys(map).length === 0 ? LEGACY_DB_NAME : `qss-${officerId.replace(/[^A-Za-z0-9_-]/g, '')}.db`;
  return { name, map: { ...map, [officerId]: name } };
}
