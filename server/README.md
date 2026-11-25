# QSS field server

The channel between the QSS Mobile Banking app and the core banking database. It does one job: it lets a mobile banker sign in, see the members of their branch, and send cash deposits. Each deposit is stored as a **PENDING** `MOBILE-BANKING` row in `SavingsTransaction`, exactly where the Approval Center already looks. The office approves it there.

It never posts to a ledger, never changes a balance, and never approves anything. It needs no change to the core system.

## What it writes

One row per deposit, always `Status='PENDING'`, `BankingType='MOBILE-BANKING'`, `UserID=<FieldOfficerID>`, `ReferenceNumber='MOBIDEMP-' + <the app's transaction id>` and `[IDEMP:...]` in the description, as the existing channel does.

- **Savings** (`kind: "SAVINGS"`, the default): `dbo.SavingsTransaction`, `TransactionType='DEPOSIT'`, `Credit=<amount>`, `PaymentMethod='CASH'`, `SavingsCode='MS'`.
- **Shares** (`kind: "SHARES"`): `dbo.ShareTransaction`, `TransactionType='PURCHASE'`, `Credit` and `TransactionAmount` `=<amount>`, `ShareCode=<ShareProductCode>`, `ShareHoldingID=<accountId>`. The core's own trigger fills the branch.

**Duplicates.** The core's unique index `UX_SavingsTransaction_MobileDepositIdempotency` is filtered to references from `MOBIDEMP-` up to (not including) `MOBIDEMQ`, which is why the server stores `MOBIDEMP-<id>` (the id may be at most 41 characters; a UUID is 36). `ShareTransaction` has no such index and the core must not be changed, so for both kinds the server takes a per-banker, per-id `sp_getapplock` inside a transaction, looks the id up in both tables (with and without the prefix, so rows written by older versions still count) and only then inserts. Sending the same deposit again returns the original (200 `DUPLICATE`); sending a different one under the same id, or the same id under the other kind, is a conflict (409). Proven against a test database: 10 simultaneous identical share deposits stored one row, as did 10 savings deposits, and 10 requests using the same id as both kinds stored one row in total.

`serverId` is the row id for savings and `SH<id>` for shares, so the two id spaces cannot clash.

## Endpoints

| Route | Purpose |
|---|---|
| `POST /v1/auth/login` | `{username, pin, deviceId}`. The banker's `FieldOfficer` username or `EmployeeID` and PIN (bcrypt). Locks out after repeated failures. |
| `POST /v1/auth/refresh` | `{refreshToken}` returns a new session. |
| `GET /v1/me` | The banker, limits, and what is waiting for approval. |
| `GET /v1/members?cursor=&limit=` | Members of the banker's branch. Each has `code, fullName, phone, status, savingsAccountId, savingsBalance` (lowest-id active savings account, kept for older app versions) and `accounts: { savings: [...], shares: [...] }`, each entry `{id, number, productCode, productName, balance}`, listing only accounts a deposit can go into today, oldest first. Savings `id` is `SavingsAccountID`, shares `id` is `ShareHoldingID`. The accounts of a whole page are read in one query. |
| `POST /v1/deposits` | `{localTransactionId, kind?, memberCode, accountId, amount, collectedAt, paymentMode?}`. `kind` is `SAVINGS` (default) or `SHARES`; `accountId` is the savings account id or the share holding id. `paymentMode` is `CASH` only: anything else is refused 422 "Mobile money deposits are not available yet." and nothing is stored, because the core's approval would post mobile money as banker cash. 201 accepted, 200 duplicate, 409 conflict, 422 rejected with a reason, 400 malformed. |
| `GET /v1/deposits?since=&limit=` | The banker's own submissions, savings and shares together, newest first, each with `kind`, the app's own `localTransactionId`, and the office's decision. |
| `GET /health` | Database check. |

A banker is read fresh from the core system on every request, so disabling them there cuts their access immediately.

## Rules enforced before anything is stored

Amount greater than zero and at most the single limit; collection time not in the future and not older than `MAX_BACKDATE_DAYS`; payment mode is cash; the account (or share holding) belongs to the member, is in the banker's branch and is `ACTIVE`; the member is active. In addition:

- Savings: not closed (`DateClosed`), not dormant (`IsDormant`), product active (`SavingsProduct.IsActive`), and the amount within `MinimumDeposit` / `MaximumDeposit` when those are set and above zero.
- Shares: not closed, product active (`ShareProduct.IsActive`), and the amount within `MinPurchaseAmount` / `MaxPurchaseAmount` when set and above zero.

Each refusal is a 422 with a plain-English reason, and nothing is stored.

**Older core databases.** At startup the server reads which columns exist (as seen by its own database login, so every table it uses needs the grants in `deploy/create-db-login.sql`) and builds its SQL from them. A rule whose column is missing is simply not applied, and the startup log and `GET /health` (`schema: {...}`) show which rules are on:

| Rule | Needs | If missing |
|---|---|---|
| Savings product active | `SavingsProduct.IsActive` | not applied |
| Savings minimum / maximum deposit | `SavingsProduct.MinimumDeposit` / `MaximumDeposit` | not applied (each separately) |
| Savings dormant / closed | `SavingsAccount.IsDormant` / `DateClosed` | not applied |
| Share product active | `ShareProduct.IsActive` | not applied |
| Share minimum / maximum purchase | `ShareProduct.MinPurchaseAmount` / `MaxPurchaseAmount` | not applied |
| Share closed / status | `ShareHolding.DateClosed` / `ShareStatus` | not applied |
| Member active / status | `Customer.IsActive` / `StatusCode` | not applied |
| Banker enabled | `FieldOfficer.IsActive` / `UsrEnabled` | not applied |
| Product name | `ProductName`, else `Description`, else the product code | falls back in that order |
| Share deposits | `ShareHolding`, `ShareProduct`, `ShareTransaction` and their key columns | `accounts.shares` is empty and a SHARES deposit is refused |
| Pending-deposit text | `AppSettings`, `SMSHistory` (with `ReferenceNo`), `Customer.CustomerID` and a member phone column | texts stay off, one log line, never an error |

The server refuses to start, with one message listing what is missing, if the basics are absent: `FieldOfficer` (id, username, password hash, branch), `Customer` (code, name, branch), `SavingsAccount` (id, customer, product code, number, balance, status) and the columns written to `SavingsTransaction`. Note that a table the login has no grant on is invisible to the probe and is treated as missing.

## Text message when a deposit is stored (optional, off by default)

After the pending row is committed and the answer has been sent, the server can text the member: `Dear <first name>, GHS <amount> received for your <product> account, pending approval. Ref: <first 8 characters of the id>`. It reuses the core's own settings and log:

- It sends only when **both** `SMS_PENDING_ENABLED=true` (this server) **and** the core's `AppSettings` `SMS_Enabled` is true, with a key and sender id set. Provider, key, sender and URL come from `AppSettings` (`SMS_Provider`, `SMS_ApiKey`, `SMS_ApiSecret`, `SMS_SenderId`, `SMS_API_URL`); the request shapes for Arkesel, Kairos Africa and Nalo are the core's.
- The number is the first usable mobile number in the core's order (alert number, contact mobile, contact phone, customer phone, ...), written `0XXXXXXXXX`. A member with `SMSAlerts = 0` is not texted.
- Never sent for a duplicate, conflict or rejection, and a failing provider never fails or delays the deposit.
- Each attempt is written to `SMSHistory` (`Module='MOBILE_BANKING'`, `MessageType='DEPOSIT_PENDING'`, `Origin='FIELD_SERVER'`, `ReferenceNo='MOBIDEMP-<id>'`); a row with the same reference and type means it is never sent twice.

**Security.** To read the settings the field server's database login needs `SELECT` on `AppSettings`, which also holds the SMS provider key. If that is not acceptable, leave `SMS_PENDING_ENABLED` off and skip that grant.

**Double-text risk for operators.** The pending text above is sent by this server. Separately, `cua-core-api`'s member-alerts job texts every new `SavingsTransaction` row with no filter on `Status`, so if `member-alerts` and its scheduler are switched on, members may also get a transaction alert for a deposit that is still pending (and again, or wrongly, for one the office later rejects). Check that setting on the core API before enabling either.

## Run locally

```
cp .env.example .env     # fill in, pointing at a TEST database
npm install
npm test                 # rules, with an in-memory stand-in for the database
npm run dev
```

Checks against a real (dummy) database are skipped unless `HERMES_INTEGRATION=1`; see the header of `test/integration.db.test.ts`. They write rows and clean up after themselves, so never point them at a live database.

## Deploy (same VPS as the database)

1. Create the limited login: `deploy/create-db-login.sql` (replace the password and the database name). Run it with `sqlcmd -I`; the core tables have filtered indexes, which need quoted identifiers on. Tested on a copy of a real core database: the login can read members, accounts and bankers and add pending deposits (the branch trigger fires normally), and is refused on updates, deletes, balances, the chart of accounts and the user table. The grants for share purchases and text messages (including reading `AppSettings`, which holds the SMS provider key) were verified on a local test database with a throwaway login: the whole integration run passed as that login, and an `UPDATE` was refused.
2. Copy `.env.example` to `.env` and fill it in. `DB_SERVER` is the SQL Server container's name on the shared Docker network, with the in-network port (1433), not the published one.
3. In `deploy/`, set `DOMAIN` (a name pointing at the VPS) and `DB_NETWORK`, then `docker compose up -d --build`. Caddy gets and renews the HTTPS certificate on its own.
4. Close the database port to the internet in the VPS firewall. Only ports 80 and 443 need to be open.

### If the VPS already runs Nginx

Port 80 and 443 are then taken, so skip Caddy. Use `deploy/docker-compose.behind-nginx.yml`, which publishes the server on `127.0.0.1:3000` only, and `deploy/nginx-field.conf` as a new server block for your name. Then `certbot --nginx -d <your name>` adds the certificate to that block. Leave existing sites alone. If the database container is on Docker's default bridge, create a network, attach the container to it (`docker network connect`, no restart needed) and set `DB_NETWORK` to that network; the server then reaches it by container name.

### Without Docker (pm2)

The server is a plain Node app, so it can run under pm2 instead of a container (used on the test VPS). Needs Node 22 and pm2.

1. Copy the `server` folder to the VPS (for example `/opt/hermes-field`) with its `.env`, then `npm ci && npm run build && npm prune --omit=dev`.
2. Add `ecosystem.config.cjs` next to `package.json`. The server must bind to `127.0.0.1` so only Nginx can reach it, and it reaches a containerised database through the port the container publishes, not the container name:

   ```js
   module.exports = {
     apps: [{
       name: 'hermes-field',
       script: 'dist/main.js',
       cwd: '/opt/hermes-field',
       node_args: '--env-file=/opt/hermes-field/.env',
       env: { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '3000', DB_SERVER: '127.0.0.1', DB_PORT: '1436' },
       max_memory_restart: '300M',
     }],
   };
   ```

   Values in `env` win over the same names in `.env`. Set `DB_SERVER` and `DB_PORT` to wherever your database is reachable from the host.
3. `pm2 start ecosystem.config.cjs`, then `pm2 startup systemd` and `pm2 save` so it comes back after a reboot.
4. To update: copy the changed files, then `npm ci && npm run build && pm2 restart hermes-field`.

Check after deploying: `GET /health` returns `{"status":"ok"}` and a sign-in works.

Point the app at `https://<domain>` with `EXPO_PUBLIC_API_URL`.
