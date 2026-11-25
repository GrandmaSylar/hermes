# QSS Mobile Banking (hermes)

App for field officers (mobilizers) of the QSS core banking system, for Android and iOS. It is a new channel of the core platform: it captures collections and registrations offline and syncs them for office approval and reconciliation.

## Layout

| Path | What |
|---|---|
| `docs/QSS_Mobile_Banker_Requirements.md` | The requirements specification (master, v1.1) |
| `docs/core-api-dev-brief.md` | Earlier wish list for the core team; the core is built, so treat it as a list of possible updates |
| `server/` | The field server: the HTTPS service the app talks to, which stores deposits as pending rows in the core database |
| `docs/core-integration.md` | How the app, the field server and the core system fit together, what is switched off, and what to settle |
| `docs/cableee.md` | Earlier draft of the spec (superseded by the master above) |
| `app/` | The React Native (Expo SDK 58, TypeScript) app |
| `git-rules (1).md` | Git rules for this project |

## Decisions in force

Android and iOS from one Expo codebase (no web version). Expo SDK 58. Cash only. No withdrawals. Oldest supported phone: Tecno Spark. Nothing posts to the ledger until approved and reconciled.

## Boundary

This project does not modify or push to `cua-core` or `cua-core-api`. The core system is already built, so the app and the field server are built to meet it as it is; anything more is an update the core team makes when ready. The app never talks to the database directly: it talks to the field server, which stores deposits as pending requests for the office to approve.

## What is built so far (foundation slice)

- Sign-in: staff ID and PIN, checked by the field server against the core's field officer record; later unlocks use the phone's biometric or screen lock. (The demo mode still shows the password-and-SMS flow of the earlier design.)
- Offline-first member search over an encrypted local database (SQLCipher, key kept in the device keystore). The app refuses to store member data if SQLCipher is missing.
- Deposits: the member screen has two actions, "Savings deposit" and "Shares deposit". Both open the same deposit screen, which lists only that type's accounts for the member (product name, account number, balance), so the officer picks the target account (preselected when there is one). An action is disabled, with a one-line reason, if the member has no account of that type. After a valid amount the screen shows the expected balance after approval (current balance plus amount, in whole pesewas). Submit opens a confirmation window (member, code, account, amount, payment, expected balance) with Confirm and Back; only Confirm saves to the on-device outbox, which then syncs automatically with idempotent delivery. Both savings and shares deposits go to the real server; the demo also shows loan repayments.
- Payment mode: Cash only for now. Mobile Money exists as a domain concept (`PaymentMode`) behind the `mobileMoney` capability, which is off, so the selector is hidden and the confirmation says "Payment: Cash". The core would post an approved Mobile Money deposit as banker cash, so it stays hidden until the core can record it as such; turning it on is one flag (`mobileMoney` in `HttpApi.capabilities`) plus the server accepting the mode.
- The app sends no SMS and says nothing about one. The server sends the member's SMS after it has stored the deposit.
- Field member registration: name, gender, date of birth (18+), mobile number, ID type and number, address. Saved to the same on-device outbox and synced idempotently as a draft for office approval. The member has no member number and cannot transact until approved. The mock refuses a duplicate ID number. ID photo and signature capture are not built yet.
- The sync screen shows what the office did with each collection that reached it: waiting, approved, approved and checked at end of day, or refused with the reason. The app asks only while something is still waiting on the office.
- Sync screen, "my customers" and frequent members, and provisional daily credits, debits and net cash.
- All server calls go through `src/data/api/contract.ts`. There are two implementations: `http.ts`, the real client for the field server (see `docs/core-integration.md`), and `mock.ts`, demo data that behaves like the fuller API in `docs/core-api-dev-brief.md`. Set `EXPO_PUBLIC_API_URL` to use the real one; without it the app shows a "Demo mode" banner.
- Features the core cannot do yet (loan repayments, member registration, SMS code, Mobile Money) are switched off by `capabilities` and hidden in the app until the core supports them.

Not built yet: ID photo and signature capture for registration, passkeys, receipts printing, reconciliation views.

## Run the app

```
cd app
npm install
npm run typecheck
npm test
npm run android      # connected Android phone or emulator
npm run ios          # needs macOS, or build in the cloud with EAS
```

**Use a development build, not Expo Go.** The encrypted database (SQLCipher) is not available in Expo Go, so the app will stop at start-up with an explanation. Create a development build with EAS or `npx expo run:android` (needs the Android SDK).

Development mock sign-in: staff ID `FO001`, password `Passw0rd!`, OTP `123456`. These are fake test values that exist only in the mock.

In a development build, the Sync tab has a "Simulate no network" switch for testing offline capture and automatic sync.

To try the app in Expo Go anyway (unencrypted, development only), start it with `EXPO_PUBLIC_ALLOW_UNENCRYPTED_DB=true`. This is ignored in release builds.

## Running in Expo Go

Expo Go lets you try the app on your own phone without building anything. It needs Expo Go for SDK 58 from the phone's app store.

One time, in the `app` folder:

```
copy .env.example .env.local        # PowerShell: Copy-Item .env.example .env.local
npm install
```

`.env.local` is ignored by git. It holds `EXPO_PUBLIC_API_URL` (the field server; leave it out to run on demo data) and `EXPO_PUBLIC_ALLOW_UNENCRYPTED_DB=true` (Expo Go has no encrypted database, so the app refuses to start without this; development only, test data only). Expo reads only this folder's env files, and only variables that start with `EXPO_PUBLIC_`.

Every time:

```
cd app
npm start
```

Wait for the QR code, then scan it from inside Expo Go. The phone and the computer must be on the **same Wi-Fi**. If they cannot be, use `npm run start:tunnel`. Press `r` in the terminal to reload the app.

Sign in as a banker from the core system's field officer list (staff ID and PIN). With no `EXPO_PUBLIC_API_URL`, the sign-in screen says "Demo mode" and the mock staff ID `FO001` works.

| What you see | What it usually means | What to do |
| :--- | :--- | :--- |
| "Secure storage is not available" at start-up | `EXPO_PUBLIC_ALLOW_UNENCRYPTED_DB` is not `true` | Put it in `app/.env.local`, then `npm run start:clear` |
| "Demo mode" on the sign-in screen | `EXPO_PUBLIC_API_URL` is empty or not read | Check `app/.env.local` (not the repo root), then `npm run start:clear` |
| Changed `.env.local` but nothing changed | Expo caches the values | `npm run start:clear` |
| Phone cannot connect to the QR code | Different Wi-Fi, or the firewall blocks Node | Same Wi-Fi, allow Node on private networks, or `npm run start:tunnel` |
| "No connection to the server" after sign-in | The server is down or the address is wrong | Open the address plus `/health` in the phone's browser; it should say `{"status":"ok"}` |
| Expo Go says the project is incompatible | Expo Go is older than SDK 58 | Update Expo Go |
| Everything looks stuck after changing code | Cached files | `npm run start:clear` |

A release build refuses to build if `EXPO_PUBLIC_API_URL` is set and is not `https://`, because staff PINs travel in those requests.

