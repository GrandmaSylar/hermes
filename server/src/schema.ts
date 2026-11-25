/**
 * The core database comes in several versions. Older ones lack columns this server would
 * like to use (product IsActive, deposit limits, ...). The server reads which columns exist
 * once at startup and builds its SQL from that: a rule whose column is missing is simply
 * not applied. Only a small minimum is required for the server to run at all.
 */

export interface ColumnRow {
  table: string;
  column: string;
}

export interface Schema {
  /** Lower-case "table.column" for every column of the tables the server touches. */
  cols: ReadonlySet<string>;
  /** Share purchases are available (all share tables and columns exist). */
  shares: boolean;
  /** The pending-deposit text message can work (settings, log and member phone data exist). */
  sms: boolean;
}

export const TABLES = [
  'FieldOfficer',
  'Customer',
  'SavingsAccount',
  'SavingsProduct',
  'SavingsTransaction',
  'ShareHolding',
  'ShareProduct',
  'ShareTransaction',
  'SMSHistory',
  'AppSettings',
  'CustomerContact',
  'CustomerAlertPreferences',
  'MobileTransactionRejection',
] as const;

const MIN_BASE = [
  'FieldOfficer.FieldOfficerID', 'FieldOfficer.Username', 'FieldOfficer.PasswordHash', 'FieldOfficer.BranchCode',
  'Customer.Code', 'Customer.FullName', 'Customer.BranchCode',
  'SavingsAccount.SavingsAccountID', 'SavingsAccount.CustomerCode', 'SavingsAccount.SavingsProductCode',
  'SavingsAccount.AccountNumber', 'SavingsAccount.CurrentBalance', 'SavingsAccount.AccountStatus',
  ...[
    'SavingsTransactionID', 'SerialNo', 'SavingsAccountID', 'CustomerCode', 'TransactionDate', 'SavingsCode', 'TransactionType', 'Debit', 'Credit',
    'Balance', 'Description', 'ReferenceNumber', 'PaymentMethod', 'BranchCode', 'UserID', 'IsReversed', 'IsActive', 'BankingType', 'Status',
  ].map((c) => `SavingsTransaction.${c}`),
];

const MIN_SHARES = [
  'ShareHolding.ShareHoldingID', 'ShareHolding.CustomerCode', 'ShareHolding.ShareProductCode',
  'ShareHolding.ShareAccountNumber', 'ShareHolding.PaidUpValue',
  ...[
    'ShareTransactionID', 'SerialNo', 'ShareHoldingID', 'CustomerCode', 'TransactionDate', 'ShareCode', 'TransactionType',
    'TransactionAmount', 'Credit', 'Description', 'ReferenceNumber', 'ValueDate', 'UserID', 'BankingType', 'Status',
  ].map((c) => `ShareTransaction.${c}`),
];

const MIN_SMS = [
  'AppSettings.Key', 'AppSettings.Value',
  'SMSHistory.ID', 'SMSHistory.PhoneNumber', 'SMSHistory.Message', 'SMSHistory.MessageType', 'SMSHistory.Status', 'SMSHistory.ReferenceNo',
  'Customer.CustomerID',
];

export class SchemaError extends Error {}

/** Builds the schema from the columns found. Throws one clear error if the minimum is missing. */
export function buildSchema(rows: ColumnRow[]): { schema: Schema; sharesMissing: string[]; smsMissing: string[] } {
  const cols = new Set(rows.map((r) => `${r.table}.${r.column}`.toLowerCase()));
  const lacking = (list: string[]) => list.filter((c) => !cols.has(c.toLowerCase()));

  const missing = lacking(MIN_BASE);
  if (missing.length) {
    throw new SchemaError(`The core database is missing what the field server needs: ${missing.join(', ')}`);
  }
  const sharesMissing = lacking(MIN_SHARES);
  const smsMissing = lacking(MIN_SMS);
  // The text message needs at least one member phone column.
  const phone = ['Customer.PhoneNo', 'CustomerContact.PhoneNo', 'CustomerContact.MobileAlert', 'CustomerAlertPreferences.MobileNo'].some((c) =>
    cols.has(c.toLowerCase()),
  );
  if (!phone) smsMissing.push('a member phone column');
  return { schema: { cols, shares: sharesMissing.length === 0, sms: smsMissing.length === 0 }, sharesMissing, smsMissing };
}

export function has(s: Schema, tableColumn: string): boolean {
  return s.cols.has(tableColumn.toLowerCase());
}

/** The rule switches an operator can see under GET /health. */
export function describe(s: Schema): Record<string, boolean> {
  return {
    sharesEnabled: s.shares,
    smsAvailable: s.sms,
    savingsProductActiveRule: has(s, 'SavingsProduct.IsActive') && has(s, 'SavingsProduct.Code'),
    savingsMinDepositRule: has(s, 'SavingsProduct.MinimumDeposit') && has(s, 'SavingsProduct.Code'),
    savingsMaxDepositRule: has(s, 'SavingsProduct.MaximumDeposit') && has(s, 'SavingsProduct.Code'),
    savingsDormantRule: has(s, 'SavingsAccount.IsDormant'),
    savingsClosedRule: has(s, 'SavingsAccount.DateClosed'),
    shareProductActiveRule: s.shares && has(s, 'ShareProduct.IsActive'),
    shareMinPurchaseRule: s.shares && has(s, 'ShareProduct.MinPurchaseAmount'),
    shareMaxPurchaseRule: s.shares && has(s, 'ShareProduct.MaxPurchaseAmount'),
    shareClosedRule: s.shares && has(s, 'ShareHolding.DateClosed'),
    shareStatusRule: s.shares && has(s, 'ShareHolding.ShareStatus'),
    memberStatusRule: has(s, 'Customer.StatusCode') || has(s, 'Customer.IsActive'),
    officerEnabledRule: has(s, 'FieldOfficer.UsrEnabled') || has(s, 'FieldOfficer.IsActive'),
  };
}

export type Kind = 'SAVINGS' | 'SHARES';

/** SQL pieces for one product family, built from the columns that exist. `a` is the account alias. */
export function product(s: Schema, kind: Kind, a: string) {
  const t = kind === 'SAVINGS' ? 'SavingsProduct' : 'ShareProduct';
  const codeCol = kind === 'SAVINGS' ? 'SavingsProductCode' : 'ShareProductCode';
  const p = 'pr';
  const haveTable = has(s, `${t}.Code`);
  const col = (c: string) => haveTable && has(s, `${t}.${c}`);
  const names = [col('ProductName') ? `NULLIF(RTRIM(${p}.ProductName), '')` : '', col('Description') ? `NULLIF(RTRIM(${p}.Description), '')` : '', `RTRIM(${a}.${codeCol})`].filter(Boolean);
  const minCol = kind === 'SAVINGS' ? 'MinimumDeposit' : 'MinPurchaseAmount';
  const maxCol = kind === 'SAVINGS' ? 'MaximumDeposit' : 'MaxPurchaseAmount';
  return {
    join: haveTable ? `LEFT JOIN dbo.${t} ${p} ON ${p}.Code = ${a}.${codeCol}` : '',
    name: `COALESCE(${names.join(', ')})`,
    /** A boolean-ish SQL value: 1 when the product is usable. A missing product row counts as not usable only when the column exists. */
    active: col('IsActive') ? `CAST(CASE WHEN ${p}.IsActive = 1 THEN 1 ELSE 0 END AS bit)` : 'CAST(1 AS bit)',
    activeCondition: col('IsActive') ? `AND ${p}.IsActive = 1` : '',
    min: col(minCol) ? `${p}.${minCol}` : 'CAST(NULL AS decimal(19,2))',
    max: col(maxCol) ? `${p}.${maxCol}` : 'CAST(NULL AS decimal(19,2))',
  };
}

/** The first existing column of `table` among the candidates, as `alias.col`, else the fallback SQL. */
export function pick(s: Schema, table: string, alias: string, column: string, fallback: string): string {
  return has(s, `${table}.${column}`) ? `${alias}.${column}` : fallback;
}
