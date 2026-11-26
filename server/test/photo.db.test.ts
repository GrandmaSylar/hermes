/**
 * Reads a real member's passport photo from a real core database. Read-only. Skipped unless HERMES_INTEGRATION=1.
 *
 *   HERMES_INTEGRATION=1 DB_SERVER=... DB_PORT=1436 DB_NAME=bankpro DB_USER=sa DB_PASSWORD=... PHOTO_MEMBER=1000004764 \
 *   npx vitest run test/photo.db.test.ts
 */
import { beforeAll, describe, expect, test } from 'vitest';
import { MssqlRepo } from '../src/mssql-repo';

const run = process.env.HERMES_INTEGRATION === '1' && !!process.env.PHOTO_MEMBER;
const d = run ? describe : describe.skip;
const env = process.env;

d('member photo against a real database', () => {
  let repo: MssqlRepo;
  const officer = (branchCode: string) => ({ id: 'x', staffId: 'x', fullName: 'X', branchCode, passwordHash: null, active: true });

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
  });

  test('returns the picture for a member in the officer\'s branch', async () => {
    const photo = await repo.getMemberPhoto(officer(env.PHOTO_BRANCH ?? '100'), env.PHOTO_MEMBER!);
    expect(photo?.mimeType).toBe('image/jpeg');
    expect(photo!.dataBase64.length).toBeGreaterThan(1000);
    expect(photo!.version).toMatch(/^[0-9a-f]+-[0-9a-f]+$/);
  });

  test('returns nothing for another branch, and for a member who does not exist', async () => {
    expect(await repo.getMemberPhoto(officer('ZZZ'), env.PHOTO_MEMBER!)).toBeNull();
    expect(await repo.getMemberPhoto(officer(env.PHOTO_BRANCH ?? '100'), '9999999999')).toBeNull();
  });
});
