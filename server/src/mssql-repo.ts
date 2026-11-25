import { randomInt, randomUUID } from 'node:crypto';
import sql from 'mssql';
import { decimalText, fromMinor, toMinor } from './money';
import { originalReference, storedReference } from './reference';
import type {
  AccountInfo,
  AccountOption,
  DepositInput,
  DepositKind,
  DepositRow,
  InsertOutcome,
  MemberRow,
  Officer,
  Repo,
  SmsLogEntry,
  SmsRecipient,
  SmsSettings,
} from './repo';
import type { Config } from './config';
import { smsPhone } from './sms';

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
  ) {}

  static async connect(db: Config['db']): Promise<MssqlRepo> {
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
    const probe = await pool.request().query(`SELECT OBJECT_ID(N'dbo.MobileTransactionRejection', N'U') AS id`);
    return new MssqlRepo(pool, probe.recordset[0]?.id != null);
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

  async findOfficer(username: string): Promise<Officer | null> {
    const result = await this.pool
      .request()
      .input('u', sql.VarChar(100), username)
      .query(
        `SELECT TOP 1 FieldOfficerID, EmployeeID, Username, FullName, BranchCode, PasswordHash, IsActive, UsrEnabled
         FROM dbo.FieldOfficer WHERE EmployeeID = @u OR Username = @u
         ORDER BY CASE WHEN EmployeeID = @u THEN 0 ELSE 1 END, FieldOfficerID`,
      );
    return result.recordset[0] ? this.officerFrom(result.recordset[0]) : null;
  }

  async getOfficer(id: string): Promise<Officer | null> {
    const n = Number(id);
    if (!Number.isSafeInteger(n)) return null;
    const result = await this.pool
      .request()
      .input('id', sql.Int, n)
      .query(
        `SELECT TOP 1 FieldOfficerID, EmployeeID, Username, FullName, BranchCode, PasswordHash, IsActive, UsrEnabled
         FROM dbo.FieldOfficer WHERE FieldOfficerID = @id`,
      );
    return result.recordset[0] ? this.officerFrom(result.recordset[0]) : null;
  }

  async listMembers(branchCode: string, afterCode: number, limit: number): Promise<MemberRow[]> {
    // One round trip, three set-based reads: the page of members, then every eligible savings
    // account and share holding of exactly those members.
    const result = await this.pool
      .request()
      .input('branch', sql.VarChar(10), branchCode)
      .input('after', sql.Numeric(10, 0), afterCode)
      .input('limit', sql.Int, limit)
      .query(
        `DECLARE @page TABLE (Code numeric(10,0) PRIMARY KEY);
         INSERT @page (Code)
           SELECT TOP (@limit) c.Code FROM dbo.Customer c
           WHERE LTRIM(RTRIM(c.BranchCode)) = @branch AND c.Code > @after
           ORDER BY c.Code;

         SELECT c.Code, c.FullName, c.PhoneNo, c.StatusCode, c.IsActive,
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

         SELECT a.CustomerCode, a.SavingsAccountID AS Id, a.AccountNumber AS Number, a.SavingsProductCode AS ProductCode,
                sp.ProductName, a.CurrentBalance AS Balance
         FROM @page p
         JOIN dbo.SavingsAccount a ON a.CustomerCode = p.Code
         JOIN dbo.SavingsProduct sp ON sp.Code = a.SavingsProductCode
         WHERE a.AccountStatus = 'ACTIVE' AND a.DateClosed IS NULL AND a.IsDormant = 0 AND sp.IsActive = 1
         ORDER BY a.CustomerCode, a.DateOpened, a.SavingsAccountID;

         SELECT h.CustomerCode, h.ShareHoldingID AS Id, h.ShareAccountNumber AS Number, h.ShareProductCode AS ProductCode,
                sp.ProductName, h.PaidUpValue AS Balance
         FROM @page p
         JOIN dbo.ShareHolding h ON h.CustomerCode = p.Code
         JOIN dbo.ShareProduct sp ON sp.Code = h.ShareProductCode
         WHERE h.ShareStatus = 'ACTIVE' AND h.DateClosed IS NULL AND sp.IsActive = 1
         ORDER BY h.CustomerCode, h.DateOpened, h.ShareHoldingID;`,
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
    const shares = group(sets[2]);

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
    const request = this.pool.request().input('id', sql.Int, accountId);
    const result =
      kind === 'SAVINGS'
        ? await request.query(
            `SELECT TOP 1 sa.SavingsAccountID AS Id, sa.CustomerCode, sa.BranchCode, sa.AccountStatus AS Status,
                    sa.CurrentBalance AS Balance, sa.DateClosed, sa.IsDormant, sa.SavingsProductCode AS ProductCode,
                    sp.ProductName, sp.IsActive AS ProductActive, sp.MinimumDeposit AS MinAmount, sp.MaximumDeposit AS MaxAmount,
                    c.IsActive AS CustomerActive, c.StatusCode AS CustomerStatus
             FROM dbo.SavingsAccount sa
             JOIN dbo.Customer c ON c.Code = sa.CustomerCode
             LEFT JOIN dbo.SavingsProduct sp ON sp.Code = sa.SavingsProductCode
             WHERE sa.SavingsAccountID = @id`,
          )
        : await request.query(
            `SELECT TOP 1 h.ShareHoldingID AS Id, h.CustomerCode, h.BranchCode, h.ShareStatus AS Status,
                    h.PaidUpValue AS Balance, h.DateClosed, CAST(0 AS bit) AS IsDormant, h.ShareProductCode AS ProductCode,
                    p.ProductName, p.IsActive AS ProductActive, p.MinPurchaseAmount AS MinAmount, p.MaxPurchaseAmount AS MaxAmount,
                    c.IsActive AS CustomerActive, c.StatusCode AS CustomerStatus
             FROM dbo.ShareHolding h
             JOIN dbo.Customer c ON c.Code = h.CustomerCode
             LEFT JOIN dbo.ShareProduct p ON p.Code = h.ShareProductCode
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
    const result = await this.pool
      .request()
      .input('uid', sql.Char(20), officerId)
      .input('since', sql.DateTime2, since)
      .input('limit', sql.Int, limit)
      .query(
        `SELECT TOP (@limit) * FROM (
           SELECT 'SAVINGS' AS Kind, st.SavingsTransactionID AS Id, st.ReferenceNumber, st.CustomerCode, st.Credit, st.Status,
                  st.CreatedAt, COALESCE(st.ApprovedAt, st.UpdatedAt) AS DecidedAt, ${reason} AS Reason
           FROM dbo.SavingsTransaction st ${rej('SavingsTransaction', 'st', 'SavingsTransactionID')}
           WHERE RTRIM(st.UserID) = @uid AND st.BankingType = '${BANKING_TYPE}'
             AND (@since IS NULL OR st.CreatedAt >= @since OR st.UpdatedAt >= @since OR st.ApprovedAt >= @since)
           UNION ALL
           SELECT 'SHARES', sh.ShareTransactionID, sh.ReferenceNumber, sh.CustomerCode, sh.Credit, sh.Status,
                  sh.CreatedAt, COALESCE(sh.ApprovedAt, sh.UpdatedAt), ${reason}
           FROM dbo.ShareTransaction sh ${rej('ShareTransaction', 'sh', 'ShareTransactionID')}
           WHERE RTRIM(sh.UserID) = @uid AND sh.BankingType = '${BANKING_TYPE}'
             AND (@since IS NULL OR sh.CreatedAt >= @since OR sh.UpdatedAt >= @since OR sh.ApprovedAt >= @since)
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
           UNION ALL
           SELECT Credit FROM dbo.ShareTransaction
           WHERE RTRIM(UserID) = @uid AND BankingType = '${BANKING_TYPE}' AND Status = 'PENDING'
         ) t`,
      );
    const r = result.recordset[0];
    return { count: Number(r.n), amount: decimalText(r.total) };
  }

  // ---- text messages: the core's own settings and log ----------------------

  async getSmsSettings(): Promise<SmsSettings> {
    const result = await this.pool
      .request()
      .query(`SELECT [Key], [Value] FROM dbo.AppSettings WHERE [Key] LIKE 'SMS[_]%'`);
    // Defaults and the "true"/"1" rule are the core's own (getSMSConfig).
    const s: SmsSettings = { enabled: false, provider: 'arkesel', apiKey: '', apiSecret: '', senderId: '', apiUrl: 'https://sms.arkesel.com/api/v2/sms/send' };
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
    const result = await this.pool
      .request()
      .input('code', sql.Numeric(10, 0), Number(customerCode))
      .query(
        `SELECT c.FirstName, c.FullName, c.PhoneNo AS CustomerPhone,
                cap.MobileNo AS AlertMobile, cap.SMSAlerts,
                cc.MobileAlert, cc.PhoneNo AS ContactPhone, cc.ContactValue, cc.AlternatePhone
         FROM dbo.Customer c
         LEFT JOIN dbo.CustomerContact cc ON cc.CustomerID = c.CustomerID
         LEFT JOIN dbo.CustomerAlertPreferences cap ON cap.CustomerID = c.CustomerID
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
    const result = await this.pool
      .request()
      .input('ref', sql.VarChar(100), referenceNo)
      .input('type', sql.NVarChar(50), messageType)
      .query(`SELECT TOP 1 1 AS found FROM dbo.SMSHistory WHERE ReferenceNo = @ref AND MessageType = @type`);
    return result.recordset.length > 0;
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
      .query(
        `INSERT dbo.SMSHistory
           (ID, PhoneNumber, Message, MessageType, Status, RecipientName, RecipientID, CustomerCode, Module,
            ReferenceNo, BranchCode, Origin, Cost, SentAt, UserID, ErrorMessage, APIResponse, CreatedBy)
         VALUES (@id, @phone, @msg, @type, @status, @name, @cust, @cust, 'MOBILE_BANKING',
            @ref, @branch, @origin, 0, @sentAt, @uid, @err, @resp, 'field-server')`,
      );
  }
}
