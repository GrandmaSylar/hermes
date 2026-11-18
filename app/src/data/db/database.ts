import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { ALLOW_UNENCRYPTED_DB } from '@/config';

const DB_NAME = 'qss.db';
const KEY_NAME = 'qss.db.key';
const SCHEMA_VERSION = 3;

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

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current >= SCHEMA_VERSION) return;

  await db.withTransactionAsync(async () => {
    if (current < 1) {
      await db.execAsync(`
        CREATE TABLE members (
          member_code   TEXT PRIMARY KEY NOT NULL,
          name          TEXT NOT NULL,
          phone         TEXT NOT NULL,
          status        TEXT NOT NULL,
          branch_code   TEXT NOT NULL,
          savings       TEXT NOT NULL,
          shares        TEXT NOT NULL,
          loan          TEXT NOT NULL,
          as_of         TEXT NOT NULL,
          search_text   TEXT NOT NULL,
          my_customer   INTEGER NOT NULL DEFAULT 0,
          collect_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX ix_members_name ON members (name);
        CREATE INDEX ix_members_mine ON members (my_customer, name);
        CREATE INDEX ix_members_frequent ON members (collect_count DESC);

        CREATE TABLE outbox (
          local_txn_id TEXT PRIMARY KEY NOT NULL,
          member_code  TEXT NOT NULL,
          member_name  TEXT NOT NULL,
          product_type TEXT NOT NULL,
          amount       TEXT NOT NULL,
          reference    TEXT,
          collected_at TEXT NOT NULL,
          status       TEXT NOT NULL,
          attempts     INTEGER NOT NULL DEFAULT 0,
          last_error   TEXT,
          server_id    TEXT,
          created_at   TEXT NOT NULL
        );
        CREATE INDEX ix_outbox_status ON outbox (status, created_at);
        CREATE INDEX ix_outbox_collected ON outbox (collected_at);

        CREATE TABLE kv (
          key   TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );
      `);
    }
    if (current < 2) {
      await db.execAsync(`
        CREATE TABLE registrations (
          local_reg_id  TEXT PRIMARY KEY NOT NULL,
          first_name    TEXT NOT NULL,
          last_name     TEXT NOT NULL,
          gender        TEXT NOT NULL,
          date_of_birth TEXT NOT NULL,
          phone         TEXT NOT NULL,
          id_type       TEXT NOT NULL,
          id_number     TEXT NOT NULL,
          address       TEXT NOT NULL,
          captured_at   TEXT NOT NULL,
          status        TEXT NOT NULL,
          attempts      INTEGER NOT NULL DEFAULT 0,
          last_error    TEXT,
          server_id     TEXT,
          created_at    TEXT NOT NULL
        );
        CREATE INDEX ix_reg_status ON registrations (status, created_at);
        CREATE INDEX ix_reg_id_number ON registrations (id_number);
      `);
    }
    if (current < 3) {
      // The core's member list has no savings account id; deposits need it.
      await db.execAsync(`
        ALTER TABLE members ADD COLUMN savings_account_id INTEGER;
        ALTER TABLE outbox ADD COLUMN account_id INTEGER;
      `);
    }
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });
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
  await db.execAsync('DELETE FROM outbox; DELETE FROM registrations; DELETE FROM members; DELETE FROM kv;');
}
