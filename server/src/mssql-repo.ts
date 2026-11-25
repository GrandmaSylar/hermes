import { randomInt } from 'node:crypto';
import sql from 'mssql';
import { decimalText, fromMinor, toMinor } from './money';
import type { AccountInfo, DepositInput, DepositRow, InsertOutcome, MemberRow, Officer, Repo } from './repo';
import type { Config } from './config';

/** The tag the core system filters on; the same value the existing channel writes. */
const BANKING_TYPE = 'MOBILE-BANKING';

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
    const result = await this.pool
      .request()
      .input('branch', sql.VarChar(10), branchCode)
      .input('after', sql.Numeric(10, 0), afterCode)
      .input('limit', sql.Int, limit)
      .query(
        `SELECT TOP (@limit)
           c.Code, c.FullName, c.PhoneNo, c.StatusCode, c.IsActive,
           sa.SavingsAccountID, sa.CurrentBalance
         FROM dbo.Customer c
         OUTER APPLY (
           SELECT TOP 1 SavingsAccountID, CurrentBalance
           FROM dbo.SavingsAccount
           WHERE CustomerCode = c.Code AND AccountStatus = 'ACTIVE'
           ORDER BY SavingsAccountID
         ) sa
         WHERE LTRIM(RTRIM(c.BranchCode)) = @branch AND c.Code > @after
         ORDER BY c.Code`,
      );
    return result.recordset.map((r) => ({
      code: String(r.Code),
      fullName: String(r.FullName ?? '').trim(),
      phone: r.PhoneNo ? String(r.PhoneNo).trim() : null,
      statusCode: String(r.StatusCode ?? '').trim(),
      isActive: Boolean(r.IsActive),
      savingsAccountId: r.SavingsAccountID ?? null,
      savingsBalance: r.SavingsAccountID == null ? null : decimalText(r.CurrentBalance),
    }));
  }

  async getAccount(savingsAccountId: number): Promise<AccountInfo | null> {
    const result = await this.pool
      .request()
      .input('id', sql.Int, savingsAccountId)
      .query(
        `SELECT TOP 1 sa.SavingsAccountID, sa.CustomerCode, sa.BranchCode, sa.AccountStatus, sa.CurrentBalance,
                c.IsActive AS CustomerActive, c.StatusCode AS CustomerStatus
         FROM dbo.SavingsAccount sa
         JOIN dbo.Customer c ON c.Code = sa.CustomerCode
         WHERE sa.SavingsAccountID = @id`,
      );
    const r = result.recordset[0];
    if (!r) return null;
    return {
      savingsAccountId: r.SavingsAccountID,
      customerCode: String(r.CustomerCode),
      branchCode: String(r.BranchCode ?? '').trim(),
      accountStatus: String(r.AccountStatus ?? '').trim(),
      currentBalance: decimalText(r.CurrentBalance),
      customerActive: Boolean(r.CustomerActive),
      customerStatusCode: String(r.CustomerStatus ?? '').trim(),
    };
  }

  private async findByReference(officerId: string, reference: string): Promise<InsertOutcome | null> {
    const existing = await this.pool
      .request()
      .input('ref', sql.VarChar(50), reference)
      .input('uid', sql.Char(20), officerId)
      .query(
        `SELECT TOP 1 SavingsTransactionID, CustomerCode, SavingsAccountID, Credit
         FROM dbo.SavingsTransaction
         WHERE ReferenceNumber = @ref AND RTRIM(UserID) = @uid
           AND TransactionType = 'DEPOSIT' AND BankingType = '${BANKING_TYPE}'`,
      );
    const r = existing.recordset[0];
    if (!r) return null;
    return {
      kind: 'EXISTS',
      id: r.SavingsTransactionID,
      customerCode: String(r.CustomerCode),
      savingsAccountId: r.SavingsAccountID,
      amount: decimalText(r.Credit),
    };
  }

  async insertDeposit(input: DepositInput): Promise<InsertOutcome> {
    const already = await this.findByReference(input.officer.id, input.reference);
    if (already) return already;

    // The row's Balance is the running balance if the office approves it. The
    // approval recomputes the account's real balance itself.
    const account = await this.getAccount(input.savingsAccountId);
    const balanceAfter = fromMinor(toMinor(account?.currentBalance ?? '0.00') + toMinor(input.amount));
    const valueDate = input.collectedAt.toISOString().slice(0, 10);
    const description = `Mobile deposit [IDEMP:idempotency_${input.reference}]`;

    for (let attempt = 0; attempt < 6; attempt++) {
      const serialNo = randomInt(100_000_000, 2_147_000_000);
      try {
        const result = await this.pool
          .request()
          .input('serial', sql.Int, serialNo)
          .input('acct', sql.Int, input.savingsAccountId)
          .input('cust', sql.Numeric(10, 0), Number(input.customerCode))
          .input('date', sql.Date, valueDate)
          .input('credit', sql.Numeric(19, 2), input.amount)
          .input('balance', sql.Numeric(19, 2), balanceAfter)
          .input('descr', sql.NVarChar(500), description)
          .input('ref', sql.VarChar(50), input.reference)
          .input('branch', sql.VarChar(10), input.branchCode)
          .input('uid', sql.Char(20), input.officer.id)
          .query(
            `INSERT dbo.SavingsTransaction
               (SerialNo, SavingsAccountID, CustomerCode, TransactionDate, SavingsCode, TransactionType,
                Debit, Credit, Balance, Description, ReferenceNumber, PaymentMethod, BranchCode, UserID,
                IsReversed, IsActive, BankingType, Status)
             VALUES (@serial, @acct, @cust, @date, 'MS', 'DEPOSIT',
                NULL, @credit, @balance, @descr, @ref, 'CASH', @branch, @uid,
                0, 1, '${BANKING_TYPE}', 'PENDING');
             SELECT CAST(SCOPE_IDENTITY() AS int) AS id;`,
          );
        return { kind: 'CREATED', id: result.recordset[0].id };
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        if (/MobileDepositIdempotency/i.test(error.message)) {
          const raced = await this.findByReference(input.officer.id, input.reference);
          if (raced) return raced;
        }
        // Otherwise the random serial number collided: try another.
      }
    }
    throw new Error('Could not allocate a serial number for the deposit');
  }

  async listDeposits(officerId: string, since: Date | null, limit: number): Promise<DepositRow[]> {
    const rejection = this.hasRejections
      ? `LEFT JOIN dbo.MobileTransactionRejection rej ON rej.SourceTable = 'SavingsTransaction' AND rej.SourceID = st.SavingsTransactionID`
      : '';
    const reason = this.hasRejections ? 'rej.Reason' : 'CAST(NULL AS NVARCHAR(500))';
    const result = await this.pool
      .request()
      .input('uid', sql.Char(20), officerId)
      .input('since', sql.DateTime2, since)
      .input('limit', sql.Int, limit)
      .query(
        `SELECT TOP (@limit) st.SavingsTransactionID, st.ReferenceNumber, st.CustomerCode, st.Credit, st.Status,
                st.CreatedAt, COALESCE(st.ApprovedAt, st.UpdatedAt) AS DecidedAt, ${reason} AS Reason
         FROM dbo.SavingsTransaction st ${rejection}
         WHERE RTRIM(st.UserID) = @uid AND st.BankingType = '${BANKING_TYPE}'
           AND (@since IS NULL OR st.CreatedAt >= @since OR st.UpdatedAt >= @since OR st.ApprovedAt >= @since)
         ORDER BY st.SavingsTransactionID DESC`,
      );
    return result.recordset.map((r) => ({
      id: r.SavingsTransactionID,
      reference: String(r.ReferenceNumber ?? ''),
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
        `SELECT COUNT(*) AS n, ISNULL(SUM(Credit), 0) AS total
         FROM dbo.SavingsTransaction
         WHERE RTRIM(UserID) = @uid AND BankingType = '${BANKING_TYPE}' AND Status = 'PENDING'`,
      );
    const r = result.recordset[0];
    return { count: Number(r.n), amount: decimalText(r.total) };
  }
}
