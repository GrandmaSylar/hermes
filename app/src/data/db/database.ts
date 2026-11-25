import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { ALLOW_UNENCRYPTED_DB } from '@/config';
import { migrate } from './migrations';

const DB_NAME = 'qss.db';
const KEY_NAME = 'qss.db.key';

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
export async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);

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

/** Wipes the encryption key and all local data, e.g. on remote kill or sign-out of a device. */
export async function wipeLocalData(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync('DELETE FROM outbox; DELETE FROM registrations; DELETE FROM member_accounts; DELETE FROM members; DELETE FROM kv;');
}
