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
| Members | `GET /v1/members?limit=&cursor=` | The banker's branch. Each item has `accounts.savings[]` and `accounts.shares[]` (`id`, `number`, `productCode`, `productName`, `balance`; the savings `id` is the SavingsAccountID, the shares `id` the ShareHoldingID) plus the older `savingsAccountId` and `savingsBalance`. If a server sends no `accounts`, the app offers one savings account built from the older fields. The phone replaces a member's accounts on every refresh, so a closed account disappears. About 25 calls for 5,000 members. |
| Office decision | `GET /v1/deposits?since=` | What the office did with each collection: `PENDING`, `APPROVED`, `VERIFIED` (checked at end of day) or `REJECTED`. The app asks only while something is still waiting. |
| Send a deposit | `POST /v1/deposits` | `localTransactionId`, `kind` (`SAVINGS` or `SHARES`), `memberCode`, `accountId` (the chosen savings account id or share holding id), `amount`, `collectedAt`, `paymentMode` (always `CASH`). 201 accepted, 200 duplicate, 409 conflict, 422 refused with a reason, 400 malformed. The app never sends a loan repayment or a non-cash mode. |

A banker is checked against the core on every request, so disabling them in the core cuts their access at once.

## Switched off

| Feature | Why |
|---|---|
| Loan repayments | Not part of the field channel. The client refuses to send them. |
| Mobile Money | Hidden (`capabilities.mobileMoney` is off). Approving a field deposit in the Approval Center posts it as banker cash, so a Mobile Money deposit would be recorded wrongly. The mode, its selector and the request field exist in the app; turn it on when the core can record the mode. |
| Registering members | No field registration route exists in the core. Registrations already captured stay safe on the phone. |
| SMS code at sign-in | The core's field login is a PIN. |
| Loan balance | Not part of the field channel. Share balances come from the member's share holdings. |

## Things to settle with the core developer

1. A member with several accounts: the officer now chooses the target account on the phone, and the server stores the account id the app sends. The server agent's rule for which accounts are listed (eligible ones only) decides what the officer can pick.
2. Whether the office wants a banker's own ledger assigned (older versions allow bankers without one; newer ones refuse to approve without it).
3. Whether the office wants to give a reason when it refuses a collection. The app shows the reason from the core's rejection record when there is one (newer versions); older versions only give "refused".

## Running against a real server

Set `EXPO_PUBLIC_API_URL` when building, for example `EXPO_PUBLIC_API_URL=https://field.example.com` (no trailing path; the app adds `/v1`). Without it the app runs on demo data and shows a "Demo mode" banner on the sign-in screen. Use a test database for test builds; never point them at production.
