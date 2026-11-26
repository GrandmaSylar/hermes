/**
 * Saves KYC files for a real (temporary) pending member on a real core database, reads them back, then
 * deletes the member and everything written for it. Skipped unless HERMES_INTEGRATION=1.
 *
 *   HERMES_INTEGRATION=1 DB_SERVER=... DB_PORT=1436 DB_NAME=bankpro DB_USER=sa DB_PASSWORD=... \
 *   npx vitest run test/documents.db.test.ts
 *
 * Use a test database only: for a few seconds a pending member named "Dryrun Docs" exists.
 */
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { checkDocument } from '../src/documents';
import { DocumentError } from '../src/mssql-documents';
import { MssqlRepo } from '../src/mssql-repo';
import { registrationBody } from '../src/registration';

const run = process.env.HERMES_INTEGRATION === '1';
const d = run ? describe : describe.skip;
const env = process.env;

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2000, 1)]);
const PDF = Buffer.from('%PDF-1.4\n%dryrun');
const doc = (kind: 'passportPhoto' | 'idFront' | 'idBack' | 'proofOfAddress' | 'signature' | 'thumbprint', bytes: Buffer, fileName: string) => {
  const checked = checkDocument({ kind, fileName, dataBase64: bytes.toString('base64') });
  if ('problem' in checked) throw new Error(checked.problem);
  return checked;
};

d('KYC files against a real database (temporary member, removed afterwards)', () => {
  let repo: MssqlRepo;
  let pool: sql.ConnectionPool;
  let customerId = 0;
  const officer = { id: 'dry', staffId: 'dryrun-docs', fullName: 'Dry Run', branchCode: '100', passwordHash: null, active: true };

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
    if (customerId) {
      const id = customerId;
      for (const table of [
        'MemberAuthorizationCredential',
        'MemberAuthorizationProfile',
        'CustomerDocuments',
        'CustomerMedia',
        'CustomerContact',
        'CustomerAddress',
        'CustomerEmployment',
        'CustomerFinancial',
        'CustomerBeneficiary',
        'CustomerAlertPreferences',
        'CustomerGuardian',
        'CustomerCompliance',
      ]) {
        await pool.request().query(`IF OBJECT_ID('dbo.${table}') IS NOT NULL DELETE FROM dbo.${table} WHERE CustomerID = ${id}`);
      }
      await pool.request().query(`DELETE FROM dbo.Customer WHERE CustomerID = ${id} AND CreatedBy = 'dryrun-docs'`);
    }
    await repo?.close();
  });

  test('every kind lands where the core app keeps it, and sending again replaces', { timeout: 120_000 }, async () => {
    expect(repo.describeSchema().documentsEnabled).toBe(true);
    const before = (await pool.request().query('SELECT COUNT(*) AS n FROM dbo.Customer')).recordset[0].n;

    const body = registrationBody.parse({
      localRegistrationId: 'dryrun-docs-1',
      capturedAt: new Date().toISOString(),
      memberType: 'IND',
      firstName: 'Dryrun',
      lastName: 'Docs',
      birthDate: '1990-01-01',
      sex: 'Female',
      nationalId: 'GHA-777777777-7',
      phone: '0200000009',
      residentialAddress: 'Dry run street',
      region: 'Greater Accra',
      city: 'Accra',
      authorizationPreference: 'BOTH',
      beneficiaries: [{ name: 'Ama Docs', relationship: 'Spouse', percentage: 100 }],
    });
    const { memberCode } = await repo.registerMember(officer, body);
    const found = await pool.request().query(`SELECT CustomerID FROM dbo.Customer WHERE Code = ${memberCode}`);
    customerId = found.recordset[0].CustomerID;

    const profile = (await pool.request().query(`SELECT * FROM dbo.MemberAuthorizationProfile WHERE CustomerID = ${customerId}`)).recordset;
    expect(profile).toHaveLength(1);
    expect(profile[0]).toMatchObject({ PreferredAuthorizationMode: 'BOTH', Status: 'ACTIVE' });

    await repo.saveMemberDocument(officer, memberCode, doc('passportPhoto', JPEG, 'photo.jpg'));
    await repo.saveMemberDocument(officer, memberCode, doc('signature', PNG, 'sig.png'));
    await repo.saveMemberDocument(officer, memberCode, doc('thumbprint', PNG, 'thumb.png'));
    await repo.saveMemberDocument(officer, memberCode, doc('idFront', JPEG, 'front.jpg'));
    await repo.saveMemberDocument(officer, memberCode, doc('proofOfAddress', PDF, 'bill.pdf'));
    await repo.saveMemberDocument(officer, memberCode, doc('idBack', PNG, 'back.png'));

    const media = (
      await pool
        .request()
        .query(
          `SELECT DATALENGTH(MainPicture) AS pic, DATALENGTH(MainSignature) AS sig, DATALENGTH(NationalIdentity) AS nid, DATALENGTH(PictureTwo) AS two, PhotoPath, SignaturePath, DocumentsPath
           FROM dbo.CustomerMedia WHERE CustomerID = ${customerId}`,
        )
    ).recordset;
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({ pic: JPEG.length, sig: PNG.length, nid: JPEG.length, two: PDF.length, PhotoPath: 'photo.jpg', SignaturePath: 'sig.png', DocumentsPath: 'front.jpg' });

    const creds = (
      await pool
        .request()
        .query(`SELECT CredentialType, IsPrimary, Status, DATALENGTH(CredentialData) AS n, CapturedBy FROM dbo.MemberAuthorizationCredential WHERE CustomerID = ${customerId} ORDER BY CredentialType`)
    ).recordset;
    expect(creds.map((c) => c.CredentialType)).toEqual(['FACE_PHOTO', 'SIGNATURE', 'THUMBPRINT']);
    expect(creds.every((c) => c.IsPrimary === true && c.Status === 'ACTIVE')).toBe(true);

    const back = (await pool.request().query(`SELECT DocumentType, MIMEType, FileSize FROM dbo.CustomerDocuments WHERE CustomerID = ${customerId}`)).recordset;
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ DocumentType: 'NATIONAL_ID_BACK', MIMEType: 'image/png' });

    // Sending the same kind again replaces it: still one media row, one active photo credential.
    await repo.saveMemberDocument(officer, memberCode, doc('passportPhoto', PNG, 'photo2.png'));
    await repo.saveMemberDocument(officer, memberCode, doc('passportPhoto', PNG, 'photo2.png'));
    const media2 = (await pool.request().query(`SELECT COUNT(*) AS n, MAX(PhotoPath) AS p FROM dbo.CustomerMedia WHERE CustomerID = ${customerId}`)).recordset[0];
    expect(media2).toMatchObject({ n: 1, p: 'photo2.png' });
    const faces = (await pool.request().query(`SELECT IsPrimary FROM dbo.MemberAuthorizationCredential WHERE CustomerID = ${customerId} AND CredentialType = 'FACE_PHOTO' ORDER BY CredentialID`)).recordset;
    expect(faces.map((f) => f.IsPrimary)).toEqual([false, true]);

    // Not the banker's member, and not pending any more.
    await expect(repo.saveMemberDocument({ ...officer, staffId: 'someone-else' }, memberCode, doc('signature', PNG, 's.png'))).rejects.toMatchObject({ status: 404 });
    await pool.request().query(`UPDATE dbo.Customer SET StatusCode = 'ACT' WHERE CustomerID = ${customerId}`);
    await expect(repo.saveMemberDocument(officer, memberCode, doc('signature', PNG, 's.png'))).rejects.toBeInstanceOf(DocumentError);
    await expect(repo.saveMemberDocument(officer, memberCode, doc('signature', PNG, 's.png'))).rejects.toMatchObject({ status: 409 });

    void before;
  });
});
