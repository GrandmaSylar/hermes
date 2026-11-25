# Integration with the core system

The core system is already built and in use, so the app is built to meet it as it is. Anything beyond that is an update to the core, made when the core developer is ready.

## How the pieces fit

```
Phone (QSS Mobile Banking)  --HTTPS-->  Field server (/server)  --SQL-->  Core database
                                                                              ^
                              Office staff approve in the Approval Center ----+
```

What production does today, read from the live database (read-only): a mobile deposit is a row in `SavingsTransaction` with `BankingType = 'MOBILE-BANKING'` and `Status = 'PENDING'`. Office staff approve it in the Approval Center, which posts it and raises the member's balance. Later a supervisor verifies the day (`VERIFIED`). Nothing in the app or the field server posts to a ledger.

The code that wrote those rows before is not in any repository we have, so the field server was written from what the live table and the approval screen require. See `server/README.md`.

`cua-core-api`'s own `/mobile-banking` module (`field_txn`, `field_devices`) is not used in production and the Approval Center does not read it, so the app does not use it either.

## What the app uses

The client is `app/src/data/api/http.ts`. All routes are on the field server.

| App need | Route | Notes |
|---|---|---|
| Sign in | `POST /v1/auth/login` | Staff ID (the `FieldOfficer` username or EmployeeID) and PIN. No SMS step. Locks out after repeated failures. The answer carries the banker and the limits. |
| Renew session | `POST /v1/auth/refresh` | Used automatically when a call is refused as expired. Calls made together share one renewal. |
| Members | `GET /v1/members?limit=&cursor=` | The banker's branch, with each member's savings account id and balance. About 25 calls for 5,000 members. |
| Send a deposit | `POST /v1/deposits` | `localTransactionId`, `memberCode`, `accountId`, `amount`, `collectedAt`. 201 accepted, 200 duplicate, 409 conflict, 422 refused with a reason. |

A banker is checked against the core on every request, so disabling them in the core cuts their access at once.

## Switched off

| Feature | Why |
|---|---|
| Share contributions, loan repayments | Production only has savings deposits from the field. Turn on when the core is ready for them. |
| Registering members | No field registration route exists in the core. Registrations already captured stay safe on the phone. |
| SMS code at sign-in | The core's field login is a PIN. |
| Shares and loan balances | Not part of the field channel. |

## Things to settle with the core developer

1. Which savings account a deposit goes to when a member has several. The server uses the lowest active account id.
2. Whether the office wants a banker's own ledger assigned (older versions allow bankers without one; newer ones refuse to approve without it).
3. The statuses to show the banker back: `PENDING`, `APPROVED`, `VERIFIED`, `REJECTED`. The server already exposes them at `GET /v1/deposits`; the app does not show them yet.

## Running against a real server

Set `EXPO_PUBLIC_API_URL` when building, for example `EXPO_PUBLIC_API_URL=https://field.example.com` (no trailing path; the app adds `/v1`). Without it the app runs on demo data and shows a "Demo mode" banner on the sign-in screen. Use a test database for test builds; never point them at production.
