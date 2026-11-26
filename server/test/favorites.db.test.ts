/**
 * Favourites and registered-member listing against a real core database. Uses a made-up officer id and removes
 * its rows afterwards. Skipped unless HERMES_INTEGRATION=1.
 *
 *   HERMES_INTEGRATION=1 DB_SERVER=... DB_PORT=1436 DB_NAME=bankpro DB_USER=sa DB_PASSWORD=... \
 *   npx vitest run test/favorites.db.test.ts
 */
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MssqlRepo } from '../src/mssql-repo';

const run = process.env.HERMES_INTEGRATION === '1';
const d = run ? describe : describe.skip;
const env = process.env;
const OFFICER = '987654';

d('favourites against a real database', () => {
  let repo: MssqlRepo;
  let pool: sql.ConnectionPool;

  beforeAll(async () => {
    repo = await MssqlRepo.connect({
      server: env.DB_SERVER ?? '127.0.0.1',
      port: Number(env.DB_PORT ?? 1433),
      database: env.DB_NAME ?? 'bankpro_test',
      user: env.DB_USER ?? 'sa',
      password: env.DB_PASSWORD ?? '',
      encrypt: false,
      trustServerCertificate: true,
    });
    pool = (repo as unknown as { pool: sql.ConnectionPool }).pool;
  });

  afterAll(async () => {
    await pool?.request().query(`DELETE FROM dbo.FieldOfficerFavorite WHERE FieldOfficerID = ${OFFICER}`);
  });

  test('the capability is on once the table exists', () => {
    expect(repo.describeSchema().favoritesEnabled).toBe(true);
  });

  test('marking, repeating, unmarking and re-marking work, per officer', async () => {
    expect(await repo.listFavorites(OFFICER)).toEqual([]);
    await repo.setFavorite(OFFICER, '1000004764', true);
    await repo.setFavorite(OFFICER, '1000004764', true);
    await repo.setFavorite(OFFICER, '1000004765', true);
    expect(await repo.listFavorites(OFFICER)).toEqual(['1000004764', '1000004765']);
    await repo.setFavorite(OFFICER, '1000004764', false);
    expect(await repo.listFavorites(OFFICER)).toEqual(['1000004765']);
    await repo.setFavorite(OFFICER, '1000004764', true);
    expect(await repo.listFavorites(OFFICER)).toEqual(['1000004764', '1000004765']);
    expect(await repo.listFavorites('111111')).toEqual([]);
    // Unmarking something never marked does nothing.
    await repo.setFavorite(OFFICER, '1000000001', false);
    expect(await repo.listFavorites(OFFICER)).toEqual(['1000004764', '1000004765']);
  });

  test('lists the members an officer registered', async () => {
    const rows = await repo.listRegisteredMembers({ id: 'x', staffId: env.REG_STAFF ?? 'nobody', fullName: 'X', branchCode: '100', passwordHash: null, active: true }, null, 50);
    expect(Array.isArray(rows)).toBe(true);
    for (const r of rows) expect(r.code).toMatch(/^\d+$/);
  });
});
