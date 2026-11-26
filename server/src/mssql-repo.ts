import { randomInt, randomUUID } from 'node:crypto';
import sql from 'mssql';
import { decimalText, fromMinor, toMinor } from './money';
import { originalReference, storedReference } from './reference';
import type {
  AccountInfo,
  AccountOption,
  BranchInfo,
  DepositInput,
  DepositKind,
  DepositRow,
  InsertOutcome,
  MemberLookup,
  MemberRow,
  Officer,
  Repo,
  SmsLogEntry,
  SmsRecipient,
  SmsSettings,
} from './repo';
import type { Config } from './config';
import { smsPhone } from './sms';
import * as registration from './mssql-registration';
import * as documents from './mssql-documents';
import type { CheckedDocument } from './documents';
import type { RegistrationBody } from './registration';
import { buildSchema, describe as describeSchema, has, nameExpr, pick, product, TABLES, type Schema } from './schema';

/** The tag the core system filters on; the same value the existing channel writes. */
const BANKING_TYPE = 'MOBILE-BANKING';

/** Written in SMSHistory.Origin (varchar(20)) so the office can tell these texts came from the field server. */
const SMS_ORIGIN = 'FIELD_SERVER';

function isDuplicateKey(error: unknown): error is { number: number; message: string } {
  const e = error as { number?: number } | null;
  return !!e && (e.number === 2627 || e.number === 2601);
}

export class MssqlRepo implements Repo {
  private constructor(
    private readonly pool: sql.ConnectionPool,
    private readonly hasRejections: boolean,
    private readonly schema: Schema,
  ) {}

  describeSchema(): Record<string, boolean> {
    return describeSchema(this.schema);
  }

  /** Reads which columns exist (visible to this login) and builds the schema. Throws if the minimum is missing. */
  static async probeSchema(pool: sql.ConnectionPool, log: (m: string) => void = console.log) {
    const names = TABLES.map((t) => `N'${t}'`).join(',');
    const res = await pool
      .request()
      .query(
        `SELECT t.name AS tbl, c.name AS col FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id
         WHERE SCHEMA_NAME(t.schema_id) = N'dbo' AND t.name IN (${names})`,
      );
    const built = buildSchema(res.recordset.map((r) => ({ table: String(r.tbl), column: String(r.col) })));
    const on = Object.entries(describeSchema(built.schema)).map(([k, v]) => `${k}=${v ? 'on' : 'off'}`);
    log(`Core schema probed. ${on.join(' ')}`);
    if (!built.schema.shares) log(`Share deposits are off; missing: ${built.sharesMissing.join(', ')}`);
    if (!built.schema.sms) log(`Pending-deposit text messages are off; missing: ${built.smsMissing.join(', ')}`);
    if (!built.schema.registration) log(`Member registration is off; missing: ${built.registrationMissing.join(', ')}`);
    else if (!built.schema.documents) log(`KYC file upload is off; missing: ${built.documentsMissing.join(', ')}`);
    return built.schema;
  }

  static async connect(db: Config['db'], log: (m: string) => void = console.log): Promise<MssqlRepo> {
    const pool = await new sql.ConnectionPool({
      server: db.server,
      port: db.port,
      database: db.database,
      user: db.user,
      password: db.password,
      options: { encrypt: db.encrypt, trustServerCertificate: db.trustServerCertificate },
      pool: { max: 10, min: 1, idleTimeoutMillis: 30_000 },
      requestTimeout: 20_000,
      connectionTimeout: 15_000,
    }).connect();
    try {
      const schema = await MssqlRepo.probeSchema(pool, log);
      const probe = await pool.request().query(`SELECT OBJECT_ID(N'dbo.MobileTransactionRejection', N'U') AS id`);
      return new MssqlRepo(pool, probe.recordset[0]?.id != null, schema);
    } catch (error) {
      await pool.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.pool.close();
  }

  async ping(): Promise<void> {
    await this.pool.request().query('SELECT 1 AS ok');
  }

  private officerFrom(r: Record<string, unknown>): Officer {
    return {
      id: String(r.FieldOfficerID),
      staffId: String(r.EmployeeID ?? r.Username ?? '').trim(),
      fullName: String(r.FullName ?? '').trim(),
      branchCode: String(r.BranchCode ?? '').trim(),
      passwordHash: (r.PasswordHash as string | null) ?? null,
      active: Boolean(r.IsActive) && Boolean(r.UsrEnabled),
    };
  }

  /** The banker columns, with stand-ins for the optional ones an older database lacks. */
  private officerSelect(): string {
    const s = this.schema;
    const col = (c: string, fallback: string) => (has(s, `FieldOfficer.${c}`) ? c : `${fallback} AS ${c}`);
    return [
      'FieldOfficerID',
      col('EmployeeID', 'Username'),
      'Username',
      col('FullName', 'Username'),
      'BranchCode',
      'PasswordHash',
      col('IsActive', 'CAST(1 AS bit)'),
      col('UsrEnabled', 'CAST(1 AS bit)'),
    ].join(', ');
  }

  async findOfficer(username: string): Promise<Officer | null> {
    const byStaff = has(this.schema, 'FieldOfficer.EmployeeID');
    const result = await this.pool
      .request()
      .input('u', sql.VarChar(100), username)
      .query(
        `SELECT TOP 1 ${this.officerSelect()}
         FROM dbo.FieldOfficer WHERE ${byStaff ? 'EmployeeID = @u OR ' : ''}Username = @u
         ORDER BY ${byStaff ? 'CASE WHEN EmployeeID = @u THEN 0 ELSE 1 END, ' : ''}FieldOfficerID`,
      );
    return result.recordset[0] ? this.officerFrom(result.recordset[0]) : null;
  }

  async getBranchInfo(branchCode: string): Promise<BranchInfo | null> {
    if (!has(this.schema, 'Branch.Code') || !has(this.schema, 'Branch.Description')) return null;
    const city = has(this.schema, 'Branch.City') ? 'City' : "'' AS City";
    const hasHead = has(this.schema, 'Branch.IsHeadOffice');
    const head = hasHead ? 'IsHeadOffice' : 'CAST(0 AS bit) AS IsHeadOffice';
    try {
      const result = await this.pool
        .request()
        .input('code', sql.VarChar(10), branchCode)
        .query(`SELECT Code, Description, ${city}, ${head} FROM dbo.Branch WHERE LTRIM(RTRIM(Code)) = @code${hasHead ? ' OR IsHeadOffice = 1' : ''}`);
      const text = (v: unknown) => String(v ?? '').trim();
      const rows = result.recordset;
      const own = rows.find((r) => text(r.Code) === branchCode);
      const headOffice = rows.find((r) => r.IsHeadOffice === true);
      if (!own && !headOffice) return null;
      const branch = own ?? headOffice!;
      return {
        code: text(branch.Code),
        name: text(branch.Description),
        city: text(branch.City),
        creditUnion: text((headOffice ?? branch).Description),
      };
    } catch {
      return null;
    }
  }

  async getOfficer(id: string): Promise<Officer | null> {
    const n = Number(id);
    if (!Number.isSafeInteger(n)) return null;
    const result = await this.pool
      .request()
      .input('id', sql.Int, n)
      .query(
        `SELECT TOP 1 ${this.officerSelect()}
         FROM dbo.FieldOfficer WHERE FieldOfficerID = @id`,
      );
    return result.recordset[0] ? this.officerFrom(result.recordset[0]) : null;
  }

  async listMembers(branchCode: string, afterCode: number, limit: number): Promise<MemberRow[]> {
    // One round trip, three set-based reads: the page of members, then every eligible savings
    // account and share holding of exactly those members.
    const s = this.schema;
    const sp = product(s, 'SAVINGS', 'a');
    const hp = product(s, 'SHARES', 'h');
    const savingsList = `SELECT a.CustomerCode, a.SavingsAccountID AS Id, a.AccountNumber AS Number, a.SavingsProductCode AS ProductCode,
                ${sp.name} AS ProductName, a.CurrentBalance AS Balance
         FROM @page p
         JOIN dbo.SavingsAccount a ON a.CustomerCode = p.Code
         ${sp.join}
         WHERE a.AccountStatus = 'ACTIVE' ${has(s, 'SavingsAccount.DateClosed') ? 'AND a.DateClosed IS NULL' : ''}
           ${has(s, 'SavingsAccount.IsDormant') ? 'AND a.IsDormant = 0' : ''} ${sp.activeCondition}
         ORDER BY a.CustomerCode, ${has(s, 'SavingsAccount.DateOpened') ? 'a.DateOpened, ' : ''}a.SavingsAccountID;`;
    const sharesList = s.shares
      ? `SELECT h.CustomerCode, h.ShareHoldingID AS Id, h.ShareAccountNumber AS Number, h.ShareProductCode AS ProductCode,
                ${hp.name} AS ProductName, h.PaidUpValue AS Balance
         FROM @page p
         JOIN dbo.ShareHolding h ON h.CustomerCode = p.Code
         ${hp.join}
         WHERE ${has(s, 'ShareHolding.ShareStatus') ? "h.ShareStatus = 'ACTIVE'" : '1 = 1'}
           ${has(s, 'ShareHolding.DateClosed') ? 'AND h.DateClosed IS NULL' : ''} ${hp.activeCondition}
         ORDER BY h.CustomerCode, ${has(s, 'ShareHolding.DateOpened') ? 'h.DateOpened, ' : ''}h.ShareHoldingID;`
      : '';
    const result = await this.pool
      .request()
      .input('branch', sql.VarChar(10), branchCode)
      .input('after', sql.Numeric(10, 0), afterCode)
      .input('limit', sql.Int, limit)
      .query(
        `DECLARE @page TABLE (Code numeric(10,0) PRIMARY KEY);
         INSERT @page (Code)
           SELECT TOP (@limit) c.Code FROM dbo.Customer c
           WHERE LTRIM(RTRIM(ISNULL(c.BranchCode, ''))) IN (@branch, '') AND c.Code > @after
           ORDER BY c.Code;

         SELECT c.Code, ${nameExpr(s)} AS FullName, ${pick(s, 'Customer', 'c', 'PhoneNo', 'CAST(NULL AS varchar(50))')} AS PhoneNo,
                ${pick(s, 'Customer', 'c', 'StatusCode', "'ACT'")} AS StatusCode,
                ${pick(s, 'Customer', 'c', 'IsActive', 'CAST(1 AS bit)')} AS IsActive,
                sa.SavingsAccountID, sa.CurrentBalance
         FROM @page p
         JOIN dbo.Customer c ON c.Code = p.Code
         OUTER APPLY (
           SELECT TOP 1 SavingsAccountID, CurrentBalance
           FROM dbo.SavingsAccount
           WHERE CustomerCode = c.Code AND AccountStatus = 'ACTIVE'
           ORDER BY SavingsAccountID
         ) sa
         ORDER BY c.Code;

         ${savingsList}

         ${sharesList}`,
      );

    const group = (rows: Record<string, unknown>[]) => {
      const byMember = new Map<string, AccountOption[]>();
      for (const r of rows) {
        const key = String(r.CustomerCode);
        const list = byMember.get(key) ?? [];
        list.push({
          id: Number(r.Id),
          number: String(r.Number ?? '').trim(),
          productCode: String(r.ProductCode ?? '').trim(),
          productName: String(r.ProductName ?? '').trim(),
          balance: decimalText(r.Balance),
        });
        byMember.set(key, list);
      }
      return byMember;
    };
    const sets = result.recordsets as unknown as Record<string, any>[][];
    // The INSERT into @page returns no recordset, so the three reads are sets 0, 1 and 2.
    const savings = group(sets[1]);
    const shares = group(sets[2] ?? []);

    return sets[0].map((r) => ({
      code: String(r.Code),
      fullName: String(r.FullName ?? '').trim(),
      phone: r.PhoneNo ? String(r.PhoneNo).trim() : null,
      statusCode: String(r.StatusCode ?? '').trim(),
      isActive: Boolean(r.IsActive),
      savingsAccountId: r.SavingsAccountID ?? null,
      savingsBalance: r.SavingsAccountID == null ? null : decimalText(r.CurrentBalance),
      accounts: { savings: savings.get(String(r.Code)) ?? [], shares: shares.get(String(r.Code)) ?? [] },
    }));
  }

  async getAccount(kind: DepositKind, accountId: number): Promise<AccountInfo | null> {
    if (kind === 'SHARES' && !this.schema.shares) return null;
    const s = this.schema;
    const request = this.pool.request().input('id', sql.Int, accountId);
    const customerCols = `${pick(s, 'Customer', 'c', 'IsActive', 'CAST(1 AS bit)')} AS CustomerActive,
                    ${pick(s, 'Customer', 'c', 'StatusCode', "'ACT'")} AS CustomerStatus`;
    const sp = product(s, 'SAVINGS', 'sa');
    const hp = product(s, 'SHARES', 'h');
    const result =
      kind === 'SAVINGS'
        ? await request.query(
            `SELECT TOP 1 sa.SavingsAccountID AS Id, sa.CustomerCode, ${pick(s, 'SavingsAccount', 'sa', 'BranchCode', 'c.BranchCode')} AS BranchCode,
                    sa.AccountStatus AS Status, sa.CurrentBalance AS Balance,
                    ${pick(s, 'SavingsAccount', 'sa', 'DateClosed', 'CAST(NULL AS date)')} AS DateClosed,
                    ${pick(s, 'SavingsAccount', 'sa', 'IsDormant', 'CAST(0 AS bit)')} AS IsDormant,
                    sa.SavingsProductCode AS ProductCode,
                    ${sp.name} AS ProductName, ${sp.active} AS ProductActive, ${sp.min} AS MinAmount, ${sp.max} AS MaxAmount,
                    ${customerCols}
             FROM dbo.SavingsAccount sa
             JOIN dbo.Customer c ON c.Code = sa.CustomerCode
             ${sp.join}
             WHERE sa.SavingsAccountID = @id`,
          )
        : await request.query(
            `SELECT TOP 1 h.ShareHoldingID AS Id, h.CustomerCode, ${pick(s, 'ShareHolding', 'h', 'BranchCode', 'c.BranchCode')} AS BranchCode,
                    ${pick(s, 'ShareHolding', 'h', 'ShareStatus', "'ACTIVE'")} AS Status,
                    h.PaidUpValue AS Balance, ${pick(s, 'ShareHolding', 'h', 'DateClosed', 'CAST(NULL AS date)')} AS DateClosed,
                    CAST(0 AS bit) AS IsDormant, h.ShareProductCode AS ProductCode,
                    ${hp.name} AS ProductName, ${hp.active} AS ProductActive, ${hp.min} AS MinAmount, ${hp.max} AS MaxAmount,
                    ${customerCols}
             FROM dbo.ShareHolding h
             JOIN dbo.Customer c ON c.Code = h.CustomerCode
             ${hp.join}
             WHERE h.ShareHoldingID = @id`,
          );
    const r = result.recordset[0];
    if (!r) return null;
    return {
      kind,
      accountId: r.Id,
      customerCode: String(r.CustomerCode),
      branchCode: String(r.BranchCode ?? '').trim(),
      accountStatus: String(r.Status ?? '').trim(),
      currentBalance: decimalText(r.Balance),
      customerActive: Boolean(r.CustomerActive),
      customerStatusCode: String(r.CustomerStatus ?? '').trim(),
      isClosed: r.DateClosed != null,
      isDormant: Boolean(r.IsDormant),
      productCode: String(r.ProductCode ?? '').trim(),
      productName: String(r.ProductName ?? '').trim(),
      productActive: r.ProductActive != null && Boolean(r.ProductActive),
      minAmount: r.MinAmount == null ? null : decimalText(r.MinAmount),
      maxAmount: r.MaxAmount == null ? null : decimalText(r.MaxAmount),
    };
  }

  /** Finds an earlier deposit under this id in either table, written with or without the prefix. */
  private async findByReference(
    runner: sql.Transaction | sql.ConnectionPool,
    officerId: string,
    reference: string,
  ): Promise<InsertOutcome | null> {
    const request = () =>
      new sql.Request(runner as sql.Transaction)
        .input('bare', sql.VarChar(50), reference)
        .input('pref', sql.VarChar(50), storedReference(reference))
        .input('uid', sql.Char(20), officerId);

    const savings = await request().query(
      `SELECT TOP 1 SavingsTransactionID, CustomerCode, SavingsAccountID, Credit
       FROM dbo.SavingsTransaction
       WHERE ReferenceNumber IN (@bare, @pref) AND RTRIM(UserID) = @uid
         AND TransactionType = 'DEPOSIT' AND BankingType = '${BANKING_TYPE}'`,
    );
    const s = savings.recordset[0];
    if (s) {
      return {
        kind: 'EXISTS',
        depositKind: 'SAVINGS',
        id: s.SavingsTransactionID,
        customerCode: String(s.CustomerCode),
        accountId: s.SavingsAccountID,
        amount: decimalText(s.Credit),
      };
    }
    if (!this.schema.shares) return null;
    const shares = await request().query(
      `SELECT TOP 1 ShareTransactionID, CustomerCode, ShareHoldingID, Credit
       FROM dbo.ShareTransaction
       WHERE ReferenceNumber IN (@bare, @pref) AND RTRIM(UserID) = @uid
         AND TransactionType = 'PURCHASE' AND BankingType = '${BANKING_TYPE}'`,
    );
    const h = shares.recordset[0];
    if (h) {
      return {
        kind: 'EXISTS',
        depositKind: 'SHARES',
        id: h.ShareTransactionID,
        customerCode: String(h.CustomerCode),
        accountId: h.ShareHoldingID,
        amount: decimalText(h.Credit),
      };
    }
    return null;
  }

  async insertDeposit(input: DepositInput): Promise<InsertOutcome> {
    if (input.kind === 'SHARES' && !this.schema.shares) throw new Error('Share deposits are not available on this database');
    const stored = storedReference(input.reference);
    const valueDate = input.collectedAt.toISOString().slice(0, 10);
    const description = `Mobile deposit [IDEMP:idempotency_${input.reference}]`;
    // One lock per banker and transaction id, whichever kind it arrives as, so two simultaneous
    // identical requests (or the same id as savings and as shares) can never both insert.
    const lockName = `hermes-deposit:${input.officer.id}:${input.reference}`.toLowerCase();

    for (let attempt = 0; attempt < 6; attempt++) {
      const tx = new sql.Transaction(this.pool);
      await tx.begin();
      try {
        const lock = await new sql.Request(tx)
          .input('res', sql.NVarChar(255), lockName)
          .query(
            `DECLARE @r int;
             EXEC @r = sp_getapplock @Resource = @res, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 15000;
             SELECT @r AS r;`,
          );
        if (Number(lock.recordset[0]?.r) < 0) throw new Error('Could not lock the deposit reference');

        const already = await this.findByReference(tx, input.officer.id, input.reference);
        if (already) {
          await tx.commit();
          return already;
        }

        const serialNo = randomInt(100_000_000, 2_147_000_000);
        const request = new sql.Request(tx)
          .input('serial', sql.Int, serialNo)
          .input('acct', sql.Int, input.accountId)
          .input('cust', sql.Numeric(10, 0), Number(input.customerCode))
          .input('date', sql.Date, valueDate)
          .input('amt', sql.Numeric(19, 2), input.amount)
          .input('descr', sql.NVarChar(500), description)
          .input('ref', sql.VarChar(50), stored)
          .input('uid', sql.Char(20), input.officer.id);

        let id: number;
        if (input.kind === 'SAVINGS') {
          // The row's Balance is the running balance if the office approves it. The approval
          // recomputes the account's real balance itself.
          const bal = await new sql.Request(tx)
            .input('acct', sql.Int, input.accountId)
            .query(`SELECT CurrentBalance FROM dbo.SavingsAccount WHERE SavingsAccountID = @acct`);
          const balanceAfter = fromMinor(toMinor(decimalText(bal.recordset[0]?.CurrentBalance)) + toMinor(input.amount));
          const result = await request
            .input('balance', sql.Numeric(19, 2), balanceAfter)
            .input('branch', sql.VarChar(10), input.branchCode)
            .query(
              `INSERT dbo.SavingsTransaction
                 (SerialNo, SavingsAccountID, CustomerCode, TransactionDate, SavingsCode, TransactionType,
                  Debit, Credit, Balance, Description, ReferenceNumber, PaymentMethod, BranchCode, UserID,
                  IsReversed, IsActive, BankingType, Status)
               VALUES (@serial, @acct, @cust, @date, 'MS', 'DEPOSIT',
                  NULL, @amt, @balance, @descr, @ref, 'CASH', @branch, @uid,
                  0, 1, '${BANKING_TYPE}', 'PENDING');
               SELECT CAST(SCOPE_IDENTITY() AS int) AS id;`,
            );
          id = result.recordset[0].id;
        } else {
          // Exactly the columns the core's approval reads for a share purchase. A trigger fills
          // BranchCode, so no OUTPUT clause: SCOPE_IDENTITY only.
          const result = await request.input('product', sql.VarChar(20), input.productCode).query(
            `INSERT dbo.ShareTransaction
               (SerialNo, ShareHoldingID, CustomerCode, TransactionDate, ShareCode, TransactionType,
                TransactionAmount, Credit, Description, ReferenceNumber, ValueDate, UserID, BankingType, Status)
             VALUES (@serial, @acct, @cust, @date, @product, 'PURCHASE',
                @amt, @amt, @descr, @ref, @date, @uid, '${BANKING_TYPE}', 'PENDING');
             SELECT CAST(SCOPE_IDENTITY() AS int) AS id;`,
          );
          id = result.recordset[0].id;
        }
        await tx.commit();
        return { kind: 'CREATED', id };
      } catch (error) {
        try {
          await tx.rollback();
        } catch {
          // already rolled back by the server
        }
        // A random serial number collided, or another writer got the reference in first:
        // go round again, which re-checks the reference and picks a fresh serial number.
        if (!isDuplicateKey(error)) throw error;
      }
    }
    throw new Error('Could not allocate a serial number for the deposit');
  }

  async listDeposits(officerId: string, since: Date | null, limit: number): Promise<DepositRow[]> {
    const rej = (table: string, alias: string, idCol: string) =>
      this.hasRejections
        ? `LEFT JOIN dbo.MobileTransactionRejection rej ON rej.SourceTable = '${table}' AND rej.SourceID = ${alias}.${idCol}`
        : '';
    const reason = this.hasRejections ? 'rej.Reason' : 'CAST(NULL AS NVARCHAR(500))';
    const s = this.schema;
    // CreatedAt / ApprovedAt / UpdatedAt are optional on older databases.
    const part = (table: string, a: string, idCol: string, kind: string, first: boolean) => {
      const t = (c: string) => has(s, `${table}.${c}`);
      const created = t('CreatedAt') ? `${a}.CreatedAt` : t('TransactionDate') ? `CAST(${a}.TransactionDate AS datetime2)` : 'CAST(NULL AS datetime2)';
      const decided = [t('ApprovedAt') ? `${a}.ApprovedAt` : '', t('UpdatedAt') ? `${a}.UpdatedAt` : ''].filter(Boolean);
      const decidedExpr = decided.length ? `COALESCE(${decided.join(', ')})` : 'CAST(NULL AS datetime2)';
      const since = ['CreatedAt', 'UpdatedAt', 'ApprovedAt'].filter(t).map((c) => `${a}.${c} >= @since`);
      const alias = (name: string) => (first ? ` AS ${name}` : '');
      return `SELECT '${kind}'${alias('Kind')}, ${a}.${idCol}${alias('Id')}, ${a}.ReferenceNumber, ${a}.CustomerCode, ${a}.Credit, ${a}.Status,
                  ${created}${alias('CreatedAt')}, ${decidedExpr}${alias('DecidedAt')}, ${reason}${alias('Reason')}
           FROM dbo.${table} ${a} ${rej(table, a, idCol)}
           WHERE RTRIM(${a}.UserID) = @uid AND ${a}.BankingType = '${BANKING_TYPE}'
             AND (@since IS NULL${since.map((c) => ` OR ${c}`).join('')})`;
    };
    const parts = [part('SavingsTransaction', 'st', 'SavingsTransactionID', 'SAVINGS', true)];
    if (s.shares) parts.push(part('ShareTransaction', 'sh', 'ShareTransactionID', 'SHARES', false));
    const result = await this.pool
      .request()
      .input('uid', sql.Char(20), officerId)
      .input('since', sql.DateTime2, since)
      .input('limit', sql.Int, limit)
      .query(
        `SELECT TOP (@limit) * FROM (
           ${parts.join('\n           UNION ALL\n           ')}
         ) x
         ORDER BY x.CreatedAt DESC, x.Id DESC`,
      );
    return result.recordset.map((r) => ({
      kind: r.Kind as DepositKind,
      id: r.Id,
      reference: originalReference(String(r.ReferenceNumber ?? '')),
      customerCode: String(r.CustomerCode),
      amount: decimalText(r.Credit),
      status: String(r.Status ?? '').trim(),
      createdAt: r.CreatedAt,
      decidedAt: r.DecidedAt ?? null,
      reason: r.Reason ?? null,
    }));
  }

  async pendingTotals(officerId: string): Promise<{ count: number; amount: string }> {
    const result = await this.pool
      .request()
      .input('uid', sql.Char(20), officerId)
      .query(
        `SELECT COUNT(*) AS n, ISNULL(SUM(t.Credit), 0) AS total FROM (
           SELECT Credit FROM dbo.SavingsTransaction
           WHERE RTRIM(UserID) = @uid AND BankingType = '${BANKING_TYPE}' AND Status = 'PENDING'
           ${
             this.schema.shares
               ? `UNION ALL
           SELECT Credit FROM dbo.ShareTransaction
           WHERE RTRIM(UserID) = @uid AND BankingType = '${BANKING_TYPE}' AND Status = 'PENDING'`
               : ''
           }
         ) t`,
      );
    const r = result.recordset[0];
    return { count: Number(r.n), amount: decimalText(r.total) };
  }

  // ---- text messages: the core's own settings and log ----------------------

  async getSmsSettings(): Promise<SmsSettings> {
    // Defaults and the "true"/"1" rule are the core's own (getSMSConfig).
    const s: SmsSettings = { enabled: false, provider: 'arkesel', apiKey: '', apiSecret: '', senderId: '', apiUrl: 'https://sms.arkesel.com/api/v2/sms/send' };
    if (!this.schema.sms) return s; // texts are off on this database; already logged at startup
    const result = await this.pool
      .request()
      .query(`SELECT [Key], [Value] FROM dbo.AppSettings WHERE [Key] LIKE 'SMS[_]%'`);
    for (const row of result.recordset) {
      const key = String(row.Key);
      const value = row.Value == null ? '' : String(row.Value);
      if (key === 'SMS_API_URL' && value) s.apiUrl = value;
      if (key === 'SMS_Provider' && value) s.provider = value;
      if (key === 'SMS_ApiKey' && value) s.apiKey = value;
      if (key === 'SMS_ApiSecret' && value) s.apiSecret = value;
      if (key === 'SMS_SenderId' && value) s.senderId = value;
      if (key === 'SMS_Enabled') s.enabled = value === 'true' || value === '1';
    }
    return s;
  }

  async getSmsRecipient(customerCode: string): Promise<SmsRecipient> {
    if (!this.schema.sms) return { phone: null, optedOut: false, firstName: '', fullName: '' };
    const s = this.schema;
    const contact = has(s, 'CustomerContact.CustomerID');
    const prefs = has(s, 'CustomerAlertPreferences.CustomerID');
    const col = (ok: boolean, expr: string, name: string) => `${ok ? expr : 'CAST(NULL AS varchar(50))'} AS ${name}`;
    const result = await this.pool
      .request()
      .input('code', sql.Numeric(10, 0), Number(customerCode))
      .query(
        `SELECT ${col(has(s, 'Customer.FirstName'), 'c.FirstName', 'FirstName')}, c.FullName,
                ${col(has(s, 'Customer.PhoneNo'), 'c.PhoneNo', 'CustomerPhone')},
                ${col(prefs && has(s, 'CustomerAlertPreferences.MobileNo'), 'cap.MobileNo', 'AlertMobile')},
                ${prefs && has(s, 'CustomerAlertPreferences.SMSAlerts') ? 'cap.SMSAlerts' : 'CAST(NULL AS int)'} AS SMSAlerts,
                ${col(contact && has(s, 'CustomerContact.MobileAlert'), 'cc.MobileAlert', 'MobileAlert')},
                ${col(contact && has(s, 'CustomerContact.PhoneNo'), 'cc.PhoneNo', 'ContactPhone')},
                ${col(contact && has(s, 'CustomerContact.ContactValue'), 'cc.ContactValue', 'ContactValue')},
                ${col(contact && has(s, 'CustomerContact.AlternatePhone'), 'cc.AlternatePhone', 'AlternatePhone')}
         FROM dbo.Customer c
         ${contact ? 'LEFT JOIN dbo.CustomerContact cc ON cc.CustomerID = c.CustomerID' : ''}
         ${prefs ? 'LEFT JOIN dbo.CustomerAlertPreferences cap ON cap.CustomerID = c.CustomerID' : ''}
         WHERE c.Code = @code`,
      );
    const rows = result.recordset;
    // The core's order (public/utils/memberPhone.js): the number chosen for alerts first.
    const order = ['AlertMobile', 'MobileAlert', 'ContactPhone', 'CustomerPhone', 'ContactValue', 'AlternatePhone'];
    let phone: string | null = null;
    for (const column of order) {
      for (const row of rows) {
        phone = smsPhone(row[column]);
        if (phone) break;
      }
      if (phone) break;
    }
    const first = rows[0];
    const fullName = String(first?.FullName ?? '').trim();
    return {
      phone,
      optedOut: rows.some((r) => r.SMSAlerts === false || r.SMSAlerts === 0),
      firstName: String(first?.FirstName ?? '').trim() || fullName.split(/\s+/)[0] || '',
      fullName,
    };
  }

  async hasSmsLog(referenceNo: string, messageType: string): Promise<boolean> {
    if (!this.schema.sms) return false;
    const result = await this.pool
      .request()
      .input('ref', sql.VarChar(100), referenceNo)
      .input('type', sql.NVarChar(50), messageType)
      .query(`SELECT TOP 1 1 AS found FROM dbo.SMSHistory WHERE ReferenceNo = @ref AND MessageType = @type`);
    return result.recordset.length > 0;
  }

  async listMemberTypes() {
    return registration.listMemberTypes(this.pool, this.schema);
  }
  async findMemberConflicts(lookup: MemberLookup) {
    return registration.findMemberConflicts(this.pool, this.schema, lookup);
  }
  async findEarlierRegistration(officer: Officer, body: RegistrationBody) {
    return registration.findEarlierRegistration(this.pool, officer, body);
  }
  async registerMember(officer: Officer, body: RegistrationBody) {
    return registration.registerMember(this.pool, this.schema, officer, body, new Date());
  }
  async saveMemberDocument(officer: Officer, memberCode: string, doc: CheckedDocument) {
    return documents.saveMemberDocument(this.pool, this.schema, officer, memberCode, doc);
  }

  async logSms(messageType: string, e: SmsLogEntry): Promise<void> {
    await this.pool
      .request()
      .input('id', sql.NVarChar(50), randomUUID())
      .input('phone', sql.NVarChar(20), e.phone)
      .input('msg', sql.VarChar(sql.MAX), e.message)
      .input('type', sql.NVarChar(50), messageType)
      .input('status', sql.NVarChar(20), e.status)
      .input('name', sql.NVarChar(255), e.recipientName)
      .input('cust', sql.VarChar(20), e.customerCode)
      .input('ref', sql.VarChar(100), e.referenceNo)
      .input('branch', sql.VarChar(10), e.branchCode)
      .input('origin', sql.VarChar(20), SMS_ORIGIN)
      .input('sentAt', sql.DateTime, e.sentAt)
      .input('uid', sql.NVarChar(100), e.userId)
      .input('err', sql.NVarChar(500), e.error)
      .input('resp', sql.VarChar(sql.MAX), e.apiResponse)
      .query(this.smsInsertSql());
  }

  /** The log insert, using only the SMSHistory columns this database has. */
  private smsInsertSql(): string {
    const all: [string, string][] = [
      ['ID', '@id'], ['PhoneNumber', '@phone'], ['Message', '@msg'], ['MessageType', '@type'], ['Status', '@status'],
      ['RecipientName', '@name'], ['RecipientID', '@cust'], ['CustomerCode', '@cust'], ['Module', "'MOBILE_BANKING'"],
      ['ReferenceNo', '@ref'], ['BranchCode', '@branch'], ['Origin', '@origin'], ['Cost', '0'], ['SentAt', '@sentAt'],
      ['UserID', '@uid'], ['ErrorMessage', '@err'], ['APIResponse', '@resp'], ['CreatedBy', "'field-server'"],
    ];
    const use = all.filter(([c]) => has(this.schema, `SMSHistory.${c}`));
    return `INSERT dbo.SMSHistory (${use.map(([c]) => c).join(', ')}) VALUES (${use.map(([, v]) => v).join(', ')})`;
  }
}
