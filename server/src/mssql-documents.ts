import { createHash } from 'node:crypto';
import sql from 'mssql';
import { KIND_LABEL, type CheckedDocument } from './documents';
import { createdByOf } from './mssql-registration';
import type { Officer } from './repo';
import { has, type Schema } from './schema';

/**
 * Saves a KYC file for a member this banker registered. Where each file goes follows the core
 * app (DatabaseContext.createEnhancedCustomer and its authorization capture):
 *   passport photo   -> CustomerMedia.MainPicture, and the FACE_PHOTO credential
 *   ID card (front)  -> CustomerMedia.NationalIdentity
 *   proof of address -> CustomerMedia.PictureTwo
 *   signature        -> CustomerMedia.MainSignature, and the SIGNATURE credential
 *   thumbprint       -> the THUMBPRINT credential
 * The core app does not keep the back of the ID card; it goes to CustomerDocuments so it is not lost.
 *
 * A phone can only add files to a member who is still pending and who it registered itself.
 */

export class DocumentError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const MEDIA_COLUMNS: Partial<Record<CheckedDocument['kind'], { data: string; path?: string; stamp?: string }>> = {
  passportPhoto: { data: 'MainPicture', path: 'PhotoPath', stamp: 'LastPhotoUpdate' },
  signature: { data: 'MainSignature', path: 'SignaturePath', stamp: 'LastSignatureUpdate' },
  idFront: { data: 'NationalIdentity', path: 'DocumentsPath' },
  proofOfAddress: { data: 'PictureTwo' },
};

const CREDENTIAL: Partial<Record<CheckedDocument['kind'], string>> = {
  passportPhoto: 'FACE_PHOTO',
  signature: 'SIGNATURE',
  thumbprint: 'THUMBPRINT',
};

export async function saveMemberDocument(
  pool: sql.ConnectionPool,
  schema: Schema,
  officer: Officer,
  memberCode: string,
  doc: CheckedDocument,
): Promise<void> {
  const label = KIND_LABEL[doc.kind];
  const found = await pool
    .request()
    .input('code', sql.VarChar(20), memberCode)
    .query(`SELECT TOP 1 CustomerID, RTRIM(StatusCode) AS StatusCode, RTRIM(CreatedBy) AS CreatedBy FROM dbo.Customer WHERE Code = TRY_CONVERT(numeric(10,0), @code)`);
  const member = found.recordset[0];
  if (!member) throw new DocumentError(404, 'That member was not found.');
  // Same answer for "not yours" and "not found": a phone cannot probe other members.
  if (String(member.CreatedBy ?? '').trim() !== createdByOf(officer)) throw new DocumentError(404, 'That member was not found.');
  if (String(member.StatusCode ?? '').trim() !== 'PND') {
    throw new DocumentError(409, 'This member has already been approved, so documents can no longer be added from the phone.');
  }
  const customerId = Number(member.CustomerID);

  const media = MEDIA_COLUMNS[doc.kind];
  const credentialType = CREDENTIAL[doc.kind];
  const back = doc.kind === 'idBack';
  if (back && !has(schema, 'CustomerDocuments.DocumentFile')) {
    throw new DocumentError(422, `${label} cannot be stored: this database has no documents table.`);
  }
  if (media && !has(schema, `CustomerMedia.${media.data}`)) {
    throw new DocumentError(422, `${label} cannot be stored: this database has no place for it.`);
  }
  if (!media && !credentialType && !back) throw new DocumentError(422, `${label} is not supported.`);

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const req = () => new sql.Request(tx).input('cid', sql.Int, customerId);
    const data = sql.VarBinary(sql.MAX);

    if (media) {
      const exists = await req().query('SELECT 1 AS x FROM dbo.CustomerMedia WITH (UPDLOCK, HOLDLOCK) WHERE CustomerID = @cid');
      const sets: string[] = [`${media.data} = @img`];
      const cols = [media.data];
      const vals = ['@img'];
      const add = (column: string | undefined, value: string) => {
        if (!column || !has(schema, `CustomerMedia.${column}`)) return;
        sets.push(`${column} = ${value}`);
        cols.push(column);
        vals.push(value);
      };
      add(media.path, '@path');
      add(media.stamp, 'GETUTCDATE()');
      if (has(schema, 'CustomerMedia.UpdatedAt')) sets.push('UpdatedAt = GETUTCDATE()');
      const r = req().input('img', data, doc.bytes).input('path', sql.VarChar(500), doc.fileName || null);
      if (exists.recordset.length > 0) {
        await r.query(`UPDATE dbo.CustomerMedia SET ${sets.join(', ')} WHERE CustomerID = @cid`);
      } else {
        await r.query(`INSERT INTO dbo.CustomerMedia (CustomerID, ${cols.join(', ')}, CreatedAt) VALUES (@cid, ${vals.join(', ')}, GETUTCDATE())`);
      }
    }

    if (credentialType && has(schema, 'MemberAuthorizationCredential.CredentialData')) {
      const hash = createHash('sha256').update(doc.bytes).digest('hex');
      const same = await req()
        .input('type', sql.NVarChar(20), credentialType)
        .input('hash', sql.NVarChar(128), hash)
        .query(
          `SELECT 1 AS x FROM dbo.MemberAuthorizationCredential WITH (UPDLOCK, HOLDLOCK)
           WHERE CustomerID = @cid AND CredentialType = @type AND Status = 'ACTIVE' AND IsPrimary = 1 AND CredentialHash = @hash`,
        );
      if (same.recordset.length === 0) {
        await req()
          .input('type', sql.NVarChar(20), credentialType)
          .query(`UPDATE dbo.MemberAuthorizationCredential SET IsPrimary = 0 WHERE CustomerID = @cid AND CredentialType = @type AND Status = 'ACTIVE'`);
        await req()
          .input('code', sql.NVarChar(50), memberCode)
          .input('type', sql.NVarChar(20), credentialType)
          .input('mime', sql.NVarChar(100), doc.mimeType)
          .input('name', sql.NVarChar(255), doc.fileName || null)
          .input('data', data, doc.bytes)
          .input('hash', sql.NVarChar(128), hash)
          .input('by', sql.NVarChar(100), createdByOf(officer).slice(0, 100))
          .input('branch', sql.NVarChar(50), officer.branchCode.trim() || null)
          .query(
            `INSERT INTO dbo.MemberAuthorizationCredential
               (CustomerID, CustomerCode, CredentialType, CaptureMethod, DeviceID, DeviceName, MimeType, FileName, CredentialData,
                CredentialHash, IsPrimary, Status, CapturedBy, BranchCode, RecordRemarks)
             VALUES (@cid, @code, @type, 'UPLOAD', NULL, 'Field app', @mime, @name, @data, @hash, 1, 'ACTIVE', @by, @branch, 'Saved from the field app')`,
          );
      }
    }

    if (back) {
      const type = 'NATIONAL_ID_BACK';
      const exists = await req().input('type', sql.VarChar(50), type).query('SELECT 1 AS x FROM dbo.CustomerDocuments WITH (UPDLOCK, HOLDLOCK) WHERE CustomerID = @cid AND DocumentType = @type');
      const r = req()
        .input('type', sql.VarChar(50), type)
        .input('name', sql.VarChar(200), doc.fileName || 'ID card (back)')
        .input('file', data, doc.bytes)
        .input('mime', sql.NVarChar(100), doc.mimeType)
        .input('size', sql.BigInt, doc.bytes.length)
        .input('by', sql.NVarChar(100), createdByOf(officer).slice(0, 100));
      if (exists.recordset.length > 0) {
        await r.query(
          `UPDATE dbo.CustomerDocuments SET DocumentName = @name, DocumentFile = @file, MIMEType = @mime, FileSize = @size, UpdatedAt = GETUTCDATE()
           WHERE CustomerID = @cid AND DocumentType = @type`,
        );
      } else {
        await r.query(
          `INSERT INTO dbo.CustomerDocuments (CustomerID, DocumentType, DocumentName, DocumentFile, MIMEType, FileSize, CreatedBy, CreatedAt)
           VALUES (@cid, @type, @name, @file, @mime, @size, @by, GETUTCDATE())`,
        );
      }
    }

    await tx.commit();
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      // already rolled back
    }
    throw error;
  }
}
