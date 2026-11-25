# QSS field server

The channel between the QSS Mobile Banking app and the core banking database. It does one job: it lets a mobile banker sign in, see the members of their branch, and send cash deposits. Each deposit is stored as a **PENDING** `MOBILE-BANKING` row in `SavingsTransaction`, exactly where the Approval Center already looks. The office approves it there.

It never posts to a ledger, never changes a balance, and never approves anything. It needs no change to the core system.

## What it writes

One row per deposit in `dbo.SavingsTransaction`: `TransactionType='DEPOSIT'`, `Credit=<amount>`, `PaymentMethod='CASH'`, `SavingsCode='MS'`, `BankingType='MOBILE-BANKING'`, `Status='PENDING'`, `UserID=<FieldOfficerID>`, `ReferenceNumber=<the app's transaction id>`, and `[IDEMP:...]` in the description, as the existing channel does.

Duplicates are stopped by the core's own unique index on `(ReferenceNumber, UserID, TransactionType, BankingType)`. Sending the same deposit again returns the original; sending a different one under the same id is a conflict.

## Endpoints

| Route | Purpose |
|---|---|
| `POST /v1/auth/login` | `{username, pin, deviceId}`. The banker's `FieldOfficer` username or `EmployeeID` and PIN (bcrypt). Locks out after repeated failures. |
| `POST /v1/auth/refresh` | `{refreshToken}` returns a new session. |
| `GET /v1/me` | The banker, limits, and what is waiting for approval. |
| `GET /v1/members?cursor=&limit=` | Members of the banker's branch with their savings account id and balance. |
| `POST /v1/deposits` | `{localTransactionId, memberCode, accountId, amount, collectedAt}`. 201 accepted, 200 duplicate, 409 conflict, 422 rejected with a reason. |
| `GET /v1/deposits?since=` | The banker's own submissions with the office's decision. |
| `GET /health` | Database check. |

A banker is read fresh from the core system on every request, so disabling them there cuts their access immediately.

## Rules enforced before anything is stored

Amount greater than zero and at most the single limit; collection time not in the future and not older than `MAX_BACKDATE_DAYS`; the account belongs to the member, is active and is in the banker's branch; the member is active.

## Run locally

```
cp .env.example .env     # fill in, pointing at a TEST database
npm install
npm test                 # rules, with an in-memory stand-in for the database
npm run dev
```

## Deploy (same VPS as the database)

1. Create the limited login: `deploy/create-db-login.sql`. Test it on a copy of the database first; it has not yet been run against a real server.
2. Copy `.env.example` to `.env` and fill it in. `DB_SERVER` is the SQL Server container's name on the shared Docker network, with the in-network port (1433), not the published one.
3. In `deploy/`, set `DOMAIN` (a name pointing at the VPS) and `DB_NETWORK`, then `docker compose up -d --build`. Caddy gets and renews the HTTPS certificate on its own.
4. Close the database port to the internet in the VPS firewall. Only ports 80 and 443 need to be open.

Point the app at `https://<domain>` with `EXPO_PUBLIC_API_URL`.
