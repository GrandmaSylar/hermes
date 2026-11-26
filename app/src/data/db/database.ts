import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { ALLOW_UNENCRYPTED_DB } from '@/config';
import { pickDbName, type DbMap } from './db-names';
import { migrate } from './migrations';

const KEY_NAME = 'qss.db.key';
const MAP_KEY = 'qss.dbmap';

async function readMap(): Promise<DbMap> {
  try {
    const parsed = JSON.parse((await SecureStore.getItemAsync(MAP_KEY)) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as DbMap) : {};
  } catch {
    return {};
  }
}

const writeMap = (map: DbMap) => SecureStore.setItemAsync(MAP_KEY, JSON.stringify(map), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });

/** 256-bit random key, created once and kept only in the device keystore. */
async function getOrCreateKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_NAME);
  if (existing) return existing;
  const bytes = await Crypto.getRandomBytesAsync(32);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(KEY_NAME, hex, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  return hex;
}

/**
 * Opens the encrypted local database.
 *
 * Fails closed: if this build has no SQLCipher, expo-sqlite would silently
 * ignore the key and store member data in plain text, so we refuse to open it
 * (see ALLOW_UNENCRYPTED_DB for the development exception).
 */
export async function openDatabase(officerId: string, adoptLegacy = false): Promise<SQLite.SQLiteDatabase> {
  const { name, map } = pickDbName(await readMap(), officerId, adoptLegacy);
  await writeMap(map);
  const db = await SQLite.openDatabaseAsync(name);

  const cipher = await db.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version');
  if (cipher == null) {
    if (!ALLOW_UNENCRYPTED_DB) {
      await db.closeAsync();
      throw new Error(
        'Secure storage (SQLCipher) is not available in this build, so the app will not store member data. Use a development or release build, not Expo Go.',
      );
    }
  } else {
    const key = await getOrCreateKey();
    await db.execAsync(`PRAGMA key = "x'${key}'"`);
    // Fails here if the key is wrong or the file is not a valid encrypted database.
    await db.getFirstAsync('SELECT count(*) FROM sqlite_master');
  }

  await db.execAsync('PRAGMA journal_mode = WAL');
  await migrate(db);
  return db;
}

/**
 * Removes one officer's data from this phone: their database file, their downloaded photos and any unsent
 * pictures. For a phone that is being handed on. Other officers' files are untouched.
 */
export async function forgetOfficerData(db: SQLite.SQLiteDatabase | null, officerId: string): Promise<void> {
  const map = await readMap();
  const name = map[officerId];
  try {
    await db?.closeAsync();
  } catch {
    // already closed
  }
  if (name) {
    try {
      await SQLite.deleteDatabaseAsync(name);
    } catch {
      // nothing to delete
    }
    const { [officerId]: _removed, ...rest } = map;
    await writeMap(rest);
    // The picture folders are shared by everyone who uses the phone, so they go only with the last account.
    if (Object.keys(rest).length > 0) return;
  }
  try {
    const FileSystem = await import('expo-file-system/legacy');
    await FileSystem.deleteAsync(`${FileSystem.documentDirectory}kyc/`, { idempotent: true });
    await FileSystem.deleteAsync(`${FileSystem.documentDirectory}photos/`, { idempotent: true });
  } catch {
    // nothing to remove
  }
}
