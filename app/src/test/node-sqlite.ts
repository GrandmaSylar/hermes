/// <reference types="node" />
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type * as SQLite from 'expo-sqlite';

/**
 * A real SQLite (the one built into Node) wearing the small part of the
 * expo-sqlite API that the app's migrations and SQL repositories use. It lets
 * tests run the app's actual SQL, which an in-memory fake never would.
 *
 * It is not SQLCipher and not Android's SQLite build, so it proves the SQL is
 * valid and does what it says, not that a phone's engine agrees byte for byte.
 */

type Params = unknown[];

/** expo-sqlite accepts `(sql, a, b)`, `(sql, [a, b])` or `(sql, { $name: a })`. */
function bind(params: Params): { positional: SQLInputValue[]; named: Record<string, SQLInputValue> | null } {
  if (params.length === 1 && Array.isArray(params[0])) return { positional: params[0] as SQLInputValue[], named: null };
  if (params.length === 1 && params[0] !== null && typeof params[0] === 'object') {
    return { positional: [], named: params[0] as Record<string, SQLInputValue> };
  }
  return { positional: params as SQLInputValue[], named: null };
}

export function createNodeSqlite() {
  const raw = new DatabaseSync(':memory:');

  const plain = <T>(row: unknown): T => ({ ...(row as object) }) as T;

  const db = {
    raw,
    async execAsync(sql: string) {
      raw.exec(sql);
    },
    async getFirstAsync<T>(sql: string, ...params: Params): Promise<T | null> {
      const { positional, named } = bind(params);
      const stmt = raw.prepare(sql);
      const row = named ? stmt.get(named) : stmt.get(...positional);
      return row === undefined ? null : plain<T>(row);
    },
    async getAllAsync<T>(sql: string, ...params: Params): Promise<T[]> {
      const { positional, named } = bind(params);
      const stmt = raw.prepare(sql);
      return (named ? stmt.all(named) : stmt.all(...positional)).map((r) => plain<T>(r));
    },
    async runAsync(sql: string, ...params: Params) {
      const { positional, named } = bind(params);
      const stmt = raw.prepare(sql);
      const result = named ? stmt.run(named) : stmt.run(...positional);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    async withTransactionAsync(task: () => Promise<void>) {
      raw.exec('BEGIN');
      try {
        await task();
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
    async prepareAsync(sql: string) {
      const stmt = raw.prepare(sql);
      return {
        async executeAsync(params: Record<string, SQLInputValue> = {}) {
          const result = stmt.run(params);
          return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
        },
        async finalizeAsync() {},
      };
    },
  };
  return db as unknown as SQLite.SQLiteDatabase & { raw: DatabaseSync };
}
