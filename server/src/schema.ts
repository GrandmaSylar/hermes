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
  /** Members can be registered: every table the registration writes to is visible to this login. */
  registration: boolean;
  /** KYC files can be saved: the member media table is visible to this login. */
  documents: boolean;
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
  'Branch',
  'OrganizationSettings',
  'CustomerContact',
  'CustomerAlertPreferences',
  'MobileTransactionRejection',
  // Member registration
  'CustomerType',
  'CustomerAddress',
  'CustomerFinancial',
  'CustomerEmployment',
  'CustomerBeneficiary',
  'CustomerGuardian',
  'CustomerCompliance',
  // KYC files
  'CustomerMedia',
  'CustomerDocuments',
  'MemberAuthorizationProfile',
  'MemberAuthorizationCredential',
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

/** What a member registration writes to. A table that is missing, or not granted to this login, switches registration off. */
const MIN_REGISTRATION = [
  'Customer.CustomerID', 'Customer.Code', 'Customer.FirstName', 'Customer.LastName', 'Customer.MiddleName', 'Customer.BirthDate',
  'Customer.DateRegistered', 'Customer.CustomerType', 'Customer.Sex', 'Customer.MaritalStatus', 'Customer.MemberType',
  'Customer.StatusCode', 'Customer.NationalID', 'Customer.RegistrationNo', 'Customer.StaffNo', 'Customer.CreatedBy', 'Customer.CreatedAt',
  'Customer.AccountType', 'Customer.BranchCode', 'Customer.FullName',
  'CustomerType.Code', 'CustomerType.Description',
  'CustomerContact.CustomerID', 'CustomerContact.PhoneNo', 'CustomerContact.EmailAddress', 'CustomerContact.ContactValue',
  'CustomerAddress.CustomerID', 'CustomerAddress.AddressTypeID', 'CustomerAddress.ResidentialAddress', 'CustomerAddress.City', 'CustomerAddress.Region',
  'CustomerFinancial.CustomerID', 'CustomerEmployment.CustomerID', 'CustomerBeneficiary.CustomerID', 'CustomerBeneficiary.PercentAllot',
  'CustomerAlertPreferences.CustomerID', 'CustomerGuardian.CustomerID', 'CustomerCompliance.CustomerID',
];

/** What saving KYC files needs, on top of registration. The credential, profile and documents tables are used when present. */
const MIN_DOCUMENTS = ['CustomerMedia.CustomerID', 'CustomerMedia.MainPicture', 'CustomerMedia.MainSignature', 'CustomerMedia.NationalIdentity', 'CustomerMedia.PictureTwo', 'CustomerMedia.CreatedAt'];

const MIN_SMS = [
  'AppSettings.Key', 'AppSettings.Value',
  'SMSHistory.ID', 'SMSHistory.PhoneNumber', 'SMSHistory.Message', 'SMSHistory.MessageType', 'SMSHistory.Status', 'SMSHistory.ReferenceNo',
  'Customer.CustomerID',
];

export class SchemaError extends Error {}

/** Builds the schema from the columns found. Throws one clear error if the minimum is missing. */
export function buildSchema(rows: ColumnRow[]): { schema: Schema; sharesMissing: string[]; smsMissing: string[]; registrationMissing: string[]; documentsMissing: string[] } {
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
  const registrationMissing = lacking(MIN_REGISTRATION);
  const documentsMissing = lacking(MIN_DOCUMENTS);
  return {
    schema: { cols, shares: sharesMissing.length === 0, sms: smsMissing.length === 0, registration: registrationMissing.length === 0, documents: registrationMissing.length === 0 && documentsMissing.length === 0 },
    sharesMissing,
    smsMissing,
    registrationMissing,
    documentsMissing,
  };
}

export function has(s: Schema, tableColumn: string): boolean {
  return s.cols.has(tableColumn.toLowerCase());
}

/** The rule switches an operator can see under GET /health. */
export function describe(s: Schema): Record<string, boolean> {
  return {
    sharesEnabled: s.shares,
    smsAvailable: s.sms,
    registrationEnabled: s.registration,
    documentsEnabled: s.documents,
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

/**
 * SQL for a customer's display name. Members registered in the office app can have FullName left
 * empty while first and last name are filled in, so fall back to those.
 */
export function nameExpr(s: Schema, alias = 'c'): string {
  const parts = ['FirstName', 'MiddleName', 'LastName'].filter((c) => has(s, `Customer.${c}`)).map((c) => `${alias}.${c}`);
  if (parts.length === 0) return `${alias}.FullName`;
  const joined = `LTRIM(RTRIM(CONCAT_WS(' ', ${parts.map((p) => `NULLIF(LTRIM(RTRIM(${p})), '')`).join(', ')})))`;
  return `COALESCE(NULLIF(LTRIM(RTRIM(${alias}.FullName)), ''), ${joined})`;
}
