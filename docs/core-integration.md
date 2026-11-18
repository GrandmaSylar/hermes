# Integration with the core system as it is today

The core developer's direction: the app is built to meet the current `cua-core-api` codebase, and anything beyond it is an update. This page records how the app uses the existing API (read from the code on 18 Nov 2026, commit `fa46ce9`), what it assumes, and what is switched off until the core supports it. The code is `app/src/data/api/http.ts`.

## How the app uses the existing API

| App need | Core endpoint | Notes |
|---|---|---|
| Sign in | `POST /auth/login` | Staff username and password. Returns access and refresh tokens. No SMS code step exists, so the app skips it. Limited to 5 attempts a minute. |
| Renew session | `POST /auth/refresh` | Used automatically on a 401. Calls made together share one renewal. |
| Who am I | `GET /mobile-banking/bankers?search=<staffId>` | Matched exactly on `staffId`. **Assumes the login username equals the mobile banker's `staffId`.** |
| Is this phone allowed | `GET /mobile-banking/devices?officerId=` | The phone must be registered to the officer, `ACTIVE` and trusted, by a supervisor. An unregistered phone is shown its device id to give to a supervisor. |
| Members | `GET /customers?limit=100&cursor=` | Name, phone, status code (PND, ACT, INA, DOR, SUS, CLO), branch. No balances. About 50 calls for 5,000 members. |
| Savings account and balance | `GET /savings/accounts?status=ACTIVE&limit=100&cursor=` | Gives the numeric account `id` that field deposits require. Where a member has several accounts, the lowest id is used. |
| Send a deposit | `POST /mobile-banking/transactions` | `DEPOSIT` only, with `accountId`, GHS, and an `idempotency-key` of `deviceId:localTransactionId`. 400 becomes "rejected" with the core's own message; 409 becomes "needs attention". |
| Cash limit | officer `cashLimit` | Becomes the ceiling on unsynced cash on the phone. Other limits are app defaults. |

Everything the app sends is a request for the office. The core keeps it as `RECEIVED` until staff approve it; the app never posts to a ledger.

## Switched off until the core supports it

The app reads these flags from the API client (`capabilities`) and hides what is off, so it never offers an action the core would refuse.

| Feature | Why it is off | What the core needs |
|---|---|---|
| Share contributions | Intake accepts `DEPOSIT` and `WITHDRAWAL` only | A share product type on field intake |
| Loan repayments | Same | A loan repayment type with allocation at posting |
| Registering members | `POST /customers/drafts` holds private drafts for the registrar, and `POST /customers` creates a member directly. Neither is a field submission for approval. | A field registration submission that enters the approval queue, with `source=FIELD` |
| SMS code at sign-in | No second factor exists | Brief section A |
| Shares and loan balances | Not in the member list or the field channel | A balances read for the field channel |
| Member lists scoped to the officer | The core lists the whole branch | Optional; the app searches all branch members by design |

Registrations already captured stay safe on the phone and are sent when the registration flag turns on.

## Things to confirm with the core developer

1. Is the login username the same as the mobile banker's `staffId`? If not, how should the app find its own banker record?
2. Does a user with the role "Mobile Banker" or "Field Officer" have read access to `/customers` and `/savings/accounts`? Only the mobile banking routes were checked for role rules.
3. `GET /mobile-banking/bankers` returns every banker in the branch, including phone, email and cash limit, to any user who can read the module. A field officer should probably see only their own record.
4. Does intake check that the signed-in user is the officer named in `officerId`? Reading the service, the officer and device are checked, but not the signed-in person. If not enforced, one officer's login could submit as another.
5. Which savings account should a deposit go to when a member has more than one?
6. `GET /customers` page size is capped at 100. Is a larger page, or a changes-since feed, planned for 5,000+ members?
7. Idempotency: the app sends `idempotency-key = deviceId:localTransactionId`. Please confirm a repeated key with identical details returns the same transaction (it appears to) and different details returns 409.

## Running against a real server

Set `EXPO_PUBLIC_API_URL` when building, for example `EXPO_PUBLIC_API_URL=https://staging.example.com`. Without it the app runs on demo data and shows a "Demo mode" banner on the sign-in screen. Use a staging environment with its own database; never point test builds at production.
