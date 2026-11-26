import type * as SQLite from 'expo-sqlite';

/** Bump when a migration step is added below. */
export const SCHEMA_VERSION = 7;

/** The slice of expo-sqlite that migrations use, so tests can run them on another SQLite. */
export type MigrationDb = Pick<SQLite.SQLiteDatabase, 'getFirstAsync' | 'execAsync' | 'withTransactionAsync'>;

export async function migrate(db: MigrationDb): Promise<void> {
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
    if (current < 4) {
      // What the office decided about each delivered collection.
      await db.execAsync(`
        ALTER TABLE outbox ADD COLUMN office_status TEXT;
        ALTER TABLE outbox ADD COLUMN office_reason TEXT;
        ALTER TABLE outbox ADD COLUMN office_decided_at TEXT;
      `);
    }
    if (current < 5) {
      // A member can have several savings accounts and share holdings. Existing
      // members keep their one known savings account until the next refresh
      // brings the full list. Existing outbox rows get no label and count as cash.
      await db.execAsync(`
        CREATE TABLE member_accounts (
          member_code  TEXT NOT NULL,
          kind         TEXT NOT NULL,
          account_id   INTEGER NOT NULL,
          number       TEXT NOT NULL,
          product_code TEXT NOT NULL,
          product_name TEXT NOT NULL,
          balance      TEXT NOT NULL,
          PRIMARY KEY (member_code, kind, account_id)
        );
        INSERT INTO member_accounts (member_code, kind, account_id, number, product_code, product_name, balance)
          SELECT member_code, 'SAVINGS', savings_account_id, CAST(savings_account_id AS TEXT), '', 'Savings', savings
          FROM members WHERE savings_account_id IS NOT NULL;
        ALTER TABLE outbox ADD COLUMN account_label TEXT;
        ALTER TABLE outbox ADD COLUMN payment_mode TEXT NOT NULL DEFAULT 'CASH';
      `);
    }
    if (current < 6) {
      // The whole registration form, as JSON, so every field the office's form collects is kept and sent.
      // Registrations saved before this have none (they could never be sent: the core could not receive them).
      await db.execAsync(`ALTER TABLE registrations ADD COLUMN payload TEXT;`);
    }
    if (current < 7) {
      // KYC pictures chosen for a registration: where each is kept on the phone and whether it has been sent.
      await db.execAsync(`
        CREATE TABLE registration_files (
          local_reg_id TEXT NOT NULL,
          kind         TEXT NOT NULL,
          uri          TEXT NOT NULL,
          name         TEXT NOT NULL,
          mime_type    TEXT NOT NULL,
          size         INTEGER NOT NULL,
          status       TEXT NOT NULL DEFAULT 'PENDING',
          attempts     INTEGER NOT NULL DEFAULT 0,
          last_error   TEXT,
          PRIMARY KEY (local_reg_id, kind)
        );
      `);
    }
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });
}
