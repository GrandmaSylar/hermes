import sql from 'mssql';
import {
  collectIds,
  localPhone,
  memberTypeIsIndividual,
  primaryIdType,
  type RegistrationBody,
} from './registration';
import type { MemberConflict, MemberLookup, MemberTypeRow, Officer } from './repo';
import { has, nameExpr, type Schema } from './schema';

/**
 * SQL for registering a member. The inserts follow the core banking app's own registration
 * (DatabaseContext.createEnhancedCustomer), with the differences the field server needs:
 * the whole member is written in one transaction, and the member's branch, full name and
 * phone are filled in so the member shows up in the field app straight away.
 */

export async function listMemberTypes(pool: sql.ConnectionPool, schema: Schema): Promise<MemberTypeRow[]> {
  const active = has(schema, 'CustomerType.IsActive') ? 'WHERE IsActive = 1' : '';
  const order = has(schema, 'CustomerType.SortOrder') ? 'SortOrder, ' : '';
  const result = await pool
    .request()
    .query(`SELECT RTRIM(Code) AS Code, RTRIM(Description) AS Description FROM dbo.CustomerType ${active} ORDER BY ${order}Description`);
  return result.recordset
    .map((r) => ({ code: String(r.Code ?? '').trim(), description: String(r.Description ?? '').trim() }))
    .filter((t) => t.code !== '' && memberTypeIsIndividual(t.code));
}

/** Both written forms of a Ghana number, as they may be stored: 0244123456, +233244123456, 233244123456. */
function phoneForms(value: string): string[] {
  const local = localPhone(value);
  if (!/^0\d{9}$/.test(local)) return [value.trim()];
  const tail = local.slice(1);
  return [local, `+233${tail}`, `233${tail}`];
}

export async function findMemberConflicts(pool: sql.ConnectionPool, schema: Schema, lookup: MemberLookup): Promise<MemberConflict[]> {
  const found: MemberConflict[] = [];
  const name = nameExpr(schema);
  const name2 = nameExpr(schema, 'c2');
  const seen = new Set<string>();
  const add = (c: MemberConflict) => {
    const key = `${c.label}|${c.memberCode}`;
    if (!seen.has(key)) {
      seen.add(key);
      found.push(c);
    }
  };

  for (const { type, value } of collectIds(lookup.ids)) {
    if (!has(schema, `Customer.${type.column}`)) continue;
    const r = await pool
      .request()
      .input('v', sql.VarChar(30), value)
      .query(`SELECT TOP 1 c.Code, ${name} AS Name FROM dbo.Customer c WHERE UPPER(RTRIM(c.${type.column})) = @v`);
    const row = r.recordset[0];
    if (row) add({ label: type.label, value, memberCode: String(row.Code), memberName: String(row.Name ?? '').trim() });
  }

  const phone = (lookup.phone ?? '').trim();
  if (phone) {
    const forms = phoneForms(phone);
    const places: string[] = [];
    if (has(schema, 'Customer.PhoneNo')) places.push('SELECT c.Code, c.PhoneNo AS P FROM dbo.Customer c');
    places.push('SELECT c.Code, cc.PhoneNo AS P FROM dbo.CustomerContact cc JOIN dbo.Customer c ON c.CustomerID = cc.CustomerID');
    const req = pool.request();
    forms.forEach((f, i) => req.input(`p${i}`, sql.NVarChar(50), f));
    const inList = forms.map((_, i) => `@p${i}`).join(', ');
    const r = await req.query(
      `SELECT TOP 1 x.Code, ${name2} AS Name FROM (${places.join(' UNION ')}) x
       JOIN dbo.Customer c2 ON c2.Code = x.Code WHERE LTRIM(RTRIM(x.P)) IN (${inList})`,
    );
    const row = r.recordset[0];
    if (row) add({ label: 'Phone', value: phone, memberCode: String(row.Code), memberName: String(row.Name ?? '').trim() });
  }

  const email = (lookup.email ?? '').trim().toLowerCase();
  if (email) {
    const places: string[] = [];
    if (has(schema, 'Customer.Email')) places.push('SELECT c.Code, c.Email AS E FROM dbo.Customer c');
    places.push('SELECT c.Code, cc.EmailAddress AS E FROM dbo.CustomerContact cc JOIN dbo.Customer c ON c.CustomerID = cc.CustomerID');
    const r = await pool
      .request()
      .input('e', sql.NVarChar(150), email)
      .query(
        `SELECT TOP 1 x.Code, ${name2} AS Name FROM (${places.join(' UNION ')}) x
         JOIN dbo.Customer c2 ON c2.Code = x.Code WHERE LOWER(LTRIM(RTRIM(x.E))) = @e`,
      );
    const row = r.recordset[0];
    if (row) add({ label: 'Email', value: email, memberCode: String(row.Code), memberName: String(row.Name ?? '').trim() });
  }
  return found;
}

/** The pending member this banker already created from the same person's details in the last two weeks. */
export async function findEarlierRegistration(
  pool: sql.ConnectionPool,
  officer: Officer,
  body: RegistrationBody,
): Promise<string | null> {
  const r = await pool
    .request()
    .input('by', sql.NVarChar(200), officer.staffId)
    .input('first', sql.VarChar(50), body.firstName)
    .input('last', sql.VarChar(50), body.lastName)
    .input('dob', sql.Date, body.birthDate)
    .query(
      `SELECT TOP 1 Code FROM dbo.Customer
       WHERE CreatedBy = @by AND RTRIM(FirstName) = @first AND RTRIM(LastName) = @last AND BirthDate = @dob
         AND RTRIM(StatusCode) = 'PND' AND CreatedAt > DATEADD(day, -14, SYSUTCDATETIME())
       ORDER BY CustomerID DESC`,
    );
  return r.recordset[0] ? String(r.recordset[0].Code) : null;
}

const yn = (v: boolean) => (v ? 1 : 0);
const orNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());

export async function registerMember(
  pool: sql.ConnectionPool,
  schema: Schema,
  officer: Officer,
  body: RegistrationBody,
  today: Date,
): Promise<{ memberCode: string }> {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const branch = officer.branchCode.trim();
    const prefix = branch.padStart(3, '0');
    const lock = await new sql.Request(tx)
      .input('res', sql.NVarChar(255), `hermes-register:${prefix}`)
      .query(
        `DECLARE @r int;
         EXEC @r = sp_getapplock @Resource = @res, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 15000;
         SELECT @r AS r;`,
      );
    if (Number(lock.recordset[0]?.r) < 0) throw new Error('Could not reserve a member code. Try again.');

    // Same rule as the core app: 3-digit branch prefix + 7-digit sequence, continuing from the branch's highest code.
    const max = await new sql.Request(tx).input('prefix', sql.NVarChar(3), prefix).query(
      `SELECT MAX(CAST(Code AS BIGINT)) AS MaxCode FROM dbo.Customer WITH (UPDLOCK, HOLDLOCK)
       WHERE Code IS NOT NULL AND LEFT(CAST(CAST(Code AS BIGINT) AS NVARCHAR(20)), 3) = @prefix`,
    );
    const maxCode = max.recordset[0]?.MaxCode;
    const nextSeq = maxCode === null || maxCode === undefined ? 1 : (parseInt(String(maxCode).substring(3), 10) || 0) + 1;
    if (nextSeq > 9_999_999) throw new Error(`Branch ${prefix} has no member numbers left.`);
    const code = `${prefix}${String(nextSeq).padStart(7, '0')}`;

    const fullName = [body.firstName, body.middleName, body.lastName].map((p) => p.trim()).filter(Boolean).join(' ');
    const ids = { nationalId: body.nationalId, voterIdNo: body.voterIdNo, nhisNo: body.nhisNo, passportNo: body.passportNo };
    const idType = primaryIdType(ids);
    const created = officer.staffId || officer.fullName || 'field-server';

    // Customer: the columns the core app writes, plus branch, full name and phone.
    const cols: [string, string, unknown, sql.ISqlTypeFactoryWithNoParams | sql.ISqlType][] = [
      ['Code', 'code', Number(code), sql.Numeric(10, 0)],
      ['StaffNo', 'staffNo', orNull(body.staffNo), sql.VarChar(20)],
      ['FirstName', 'first', body.firstName.trim(), sql.VarChar(50)],
      ['LastName', 'last', body.lastName.trim(), sql.VarChar(50)],
      ['MiddleName', 'middle', orNull(body.middleName), sql.VarChar(50)],
      ['FullName', 'full', fullName, sql.VarChar(101)],
      ['BirthDate', 'dob', body.birthDate, sql.Date],
      ['DateRegistered', 'regDate', today.toISOString().slice(0, 10), sql.Date],
      ['CustomerType', 'ctype', body.memberType.trim(), sql.VarChar(20)],
      ['Sex', 'sex', body.sex, sql.VarChar(10)],
      ['MaritalStatus', 'marital', orNull(body.maritalStatus), sql.VarChar(15)],
      ['MemberType', 'mtype', body.memberType.trim(), sql.VarChar(20)],
      ['StatusCode', 'status', 'PND', sql.VarChar(15)],
      ['NationalID', 'nid', orNull(body.nationalId.toUpperCase()), sql.VarChar(30)],
      ['RegistrationNo', 'regNo', orNull(body.registrationNo), sql.VarChar(30)],
      ['CreatedBy', 'createdBy', created, sql.NVarChar(200)],
      ['AccountType', 'acctType', 'INDIVIDUAL', sql.NVarChar(60)],
      ['BranchCode', 'branch', branch, sql.NVarChar(100)],
    ];
    const optional: [string, string, unknown, sql.ISqlTypeFactoryWithNoParams | sql.ISqlType][] = [
      ['VoterIDNo', 'voter', orNull(body.voterIdNo.toUpperCase()), sql.VarChar(30)],
      ['NHISNo', 'nhis', orNull(body.nhisNo.toUpperCase()), sql.VarChar(30)],
      ['PassportNo', 'passport', orNull(body.passportNo.toUpperCase()), sql.VarChar(30)],
      ['IDType', 'idType', idType, sql.NVarChar(60)],
      ['PhoneNo', 'phoneNo', body.phone.trim(), sql.NVarChar(100)],
      ['RegisteredByBankerID', 'bankerId', officer.id, sql.VarChar(50)],
    ];
    for (const o of optional) if (has(schema, `Customer.${o[0]}`) && (o[2] !== null || o[0] === 'PhoneNo')) cols.push(o);

    const insert = new sql.Request(tx);
    for (const [, param, value, type] of cols) insert.input(param, type as sql.ISqlType, value);
    const customer = await insert.query(
      `INSERT INTO dbo.Customer (${cols.map((c) => c[0]).join(', ')}, CreatedAt)
       VALUES (${cols.map((c) => `@${c[1]}`).join(', ')}, GETUTCDATE());
       SELECT CAST(SCOPE_IDENTITY() AS int) AS CustomerID;`,
    );
    const customerId = Number(customer.recordset[0].CustomerID);
    const child = () => new sql.Request(tx).input('cid', sql.Int, customerId);

    await child()
      .input('phone', sql.VarChar(50), body.phone.trim())
      .input('email', sql.VarChar(150), orNull(body.email))
      .input('contactValue', sql.VarChar(200), body.contactValue.trim())
      .input('mobileAlert', sql.VarChar(50), (body.mobileAlert || body.phone).trim())
      .input('subscribe', sql.Bit, 1)
      .input('marketing', sql.Bit, yn(body.allowMarketing))
      .input('time', sql.VarChar(50), orNull(body.preferredContactTime))
      .query(
        `INSERT INTO dbo.CustomerContact (CustomerID, PhoneNo, EmailAddress, ContactValue, URLAddress, MobileAlert, SubscribeAlert, AllowMarketing, PreferredContactTime, CreatedAt)
         VALUES (@cid, @phone, @email, @contactValue, NULL, @mobileAlert, @subscribe, @marketing, @time, GETUTCDATE())`,
      );

    await child()
      .input('residential', sql.VarChar(200), body.residentialAddress.trim())
      .input('line1', sql.VarChar(200), orNull(body.addressLine1))
      .input('line2', sql.VarChar(200), orNull(body.addressLine2))
      .input('line3', sql.VarChar(200), orNull(body.addressLine3))
      .input('city', sql.VarChar(100), body.city.trim())
      .input('region', sql.VarChar(100), body.region.trim())
      .input('landmark', sql.VarChar(200), orNull(body.landmark))
      .input('gps', sql.VarChar(50), orNull(body.gpsCoordinates))
      .query(
        `INSERT INTO dbo.CustomerAddress (CustomerID, AddressTypeID, Address, ResidentialAddress, AddressLine1, AddressLine2, AddressLine3, City, Region, Country, Landmark, GPSCoordinates, IsPrimary, CreatedAt)
         VALUES (@cid, 1, @residential, @residential, @line1, @line2, @line3, @city, @region, 'Ghana', @landmark, @gps, 1, GETUTCDATE())`,
      );

    if (body.employerName.trim() !== '') {
      await child()
        .input('employer', sql.VarChar(50), body.employerName.trim())
        .input('address', sql.VarChar(80), orNull(body.employerAddress))
        .input('contact', sql.VarChar(50), orNull(body.employerContact))
        .input('job', sql.VarChar(100), orNull(body.jobTitle))
        .input('type', sql.VarChar(20), orNull(body.employmentType))
        .input('income', sql.VarChar(200), orNull(body.incomeSource))
        .input('years', sql.Int, body.yearsWithEmployer.trim() === '' ? null : Math.floor(Number(body.yearsWithEmployer)))
        .query(
          `INSERT INTO dbo.CustomerEmployment (CustomerID, EmployerName, EmployerAddress, EmployerContact, JobTitle, EmploymentType, IncomeSource, YearsWithEmployer, CreatedAt)
           VALUES (@cid, @employer, @address, @contact, @job, @type, @income, @years, GETUTCDATE())`,
        );
    }

    if (body.sourceOfFunds || body.customerBank || body.bankAccountNo || body.expectedTransactionVolume || body.politicallyExposed) {
      await child()
        .input('purpose', sql.VarChar(100), null)
        .input('volume', sql.VarChar(50), orNull(body.expectedTransactionVolume))
        .input('source', sql.VarChar(50), orNull(body.sourceOfFunds))
        .input('bank', sql.NVarChar(100), orNull(body.customerBank))
        .input('bankBranch', sql.NVarChar(100), orNull(body.customerBranch))
        .input('account', sql.NVarChar(50), orNull(body.bankAccountNo))
        .input('pep', sql.Bit, yn(body.politicallyExposed))
        .query(
          `INSERT INTO dbo.CustomerFinancial (CustomerID, MonthlyShares, MonthlySavings, AccountPurpose, ExpectedTransactionVolume, SourceOfFunds,
                                              CustomerBank, CustomerBranch, BankAccountNo, PoliticallyExposed, CreatedAt)
           VALUES (@cid, 0, 0, @purpose, @volume, @source, @bank, @bankBranch, @account, @pep, GETUTCDATE())`,
        );
    }

    for (const b of body.beneficiaries) {
      await child()
        .input('name', sql.VarChar(30), b.name.trim())
        .input('address', sql.VarChar(30), orNull(b.address))
        .input('pct', sql.Numeric(7, 3), b.percentage)
        .input('rel', sql.Char(30), b.relationship.trim())
        .input('phone', sql.VarChar(50), orNull(b.phone))
        .input('email', sql.VarChar(100), orNull(b.email))
        .input('minor', sql.Bit, yn(b.isMinor))
        .input('gName', sql.VarChar(200), orNull(b.guardianName))
        .input('gPhone', sql.VarChar(50), orNull(b.guardianPhone))
        .query(
          `INSERT INTO dbo.CustomerBeneficiary (CustomerID, Name, Address, PercentAllot, Relationship, PhoneNumber, Email, IsMinor, GuardianName, GuardianPhone, CreatedAt)
           VALUES (@cid, @name, @address, @pct, @rel, @phone, @email, @minor, @gName, @gPhone, GETUTCDATE())`,
        );
    }

    const a = body.alerts;
    await child()
      .input('mobile', sql.VarChar(20), body.phone.trim())
      .input('email', sql.VarChar(150), orNull(body.email))
      .input('sms', sql.Bit, yn(a.sms))
      .input('mail', sql.Bit, yn(a.email))
      .input('trans', sql.Bit, yn(a.transaction))
      .input('loan', sql.Bit, yn(a.loan))
      .input('maturity', sql.Bit, yn(a.maturity))
      .input('promo', sql.Bit, yn(a.promotional))
      .query(
        `INSERT INTO dbo.CustomerAlertPreferences (CustomerID, MobileNo, EmailAddress, SMSAlerts, EmailAlerts, TransactionAlerts, LoanAlerts, MaturityAlerts, PromotionalAlerts,
                                                    PreferElectronicStatements, PreferElectronicNotices, StatementDeliveryMethod, StatementFrequency, CreatedAt)
         VALUES (@cid, @mobile, @email, @sms, @mail, @trans, @loan, @maturity, @promo, 1, 1, 'Electronic', 'Monthly', GETUTCDATE())`,
      );

    const g = body.guardian;
    if (g && g.name.trim() !== '') {
      await child()
        .input('name', sql.VarChar(200), g.name.trim())
        .input('nid', sql.VarChar(30), orNull(g.nationalId.toUpperCase()))
        .input('phone', sql.VarChar(50), orNull(g.phone))
        .input('rel', sql.VarChar(50), orNull(g.relationship))
        .input('address', sql.VarChar(200), orNull(g.address))
        .input('employer', sql.VarChar(200), orNull(g.employer))
        .query(
          `INSERT INTO dbo.CustomerGuardian (CustomerID, GuardianName, GuardianNationalID, GuardianPhone, GuardianRelationship, GuardianAddress, GuardianEmployer, CreatedAt)
           VALUES (@cid, @name, @nid, @phone, @rel, @address, @employer, GETUTCDATE())`,
        );
    }

    await child()
      .input('pep', sql.Bit, yn(body.politicallyExposed))
      .query(
        `INSERT INTO dbo.CustomerCompliance (CustomerID, PEPStatus, SanctionsCheck, SanctionsStatus, KYCVerified, KYCStatus, AMLCompliant, AMLRiskScore, RiskRating, RiskAssessment, ComplianceNotes, CreatedAt)
         VALUES (@cid, @pep, 0, NULL, 0, 'Pending', 0, 0, 'Low', NULL, NULL, GETUTCDATE())`,
      );

    await tx.commit();
    return { memberCode: code };
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      // already rolled back
    }
    throw error;
  }
}
