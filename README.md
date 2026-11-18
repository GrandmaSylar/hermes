# QSS Mobile Banking (hermes)

App for field officers (mobilizers) of the QSS core banking system, for Android and iOS. It is a new channel of the core platform: it captures collections and registrations offline and syncs them for office approval and reconciliation.

## Layout

| Path | What |
|---|---|
| `docs/QSS_Mobile_Banker_Requirements.md` | The requirements specification (master, v1.1) |
| `docs/core-api-dev-brief.md` | What the core banking team must provide in `cua-core-api` |
| `docs/cableee.md` | Earlier draft of the spec (superseded by the master above) |
| `app/` | The React Native (Expo SDK 58, TypeScript) app |
| `git-rules (1).md` | Git rules for this project |

## Decisions in force

Android and iOS from one Expo codebase (no web version). Expo SDK 58. Cash only. No withdrawals. Oldest supported phone: Tecno Spark. Nothing posts to the ledger until approved and reconciled.

## Boundary

This project does not modify or push to `cua-core-api`. The app talks to the core system only through its published API, against a staging environment.

## What is built so far (foundation slice)

- Sign-in: password, then an SMS OTP (first sign-in on a device); later unlocks use the phone's biometric or screen lock. Real passkeys are a later slice and need the core system's WebAuthn endpoints.
- Offline-first member search over an encrypted local database (SQLCipher, key kept in the device keystore). The app refuses to store member data if SQLCipher is missing.
- Cash collection capture (savings deposit, share contribution, loan repayment) saved to an on-device outbox, then synced automatically with idempotent delivery.
- Field member registration: name, gender, date of birth (18+), mobile number, ID type and number, address. Saved to the same on-device outbox and synced idempotently as a draft for office approval. The member has no member number and cannot transact until approved. The mock refuses a duplicate ID number. ID photo and signature capture are not built yet.
- Sync screen, "my customers" and frequent members, and provisional daily credits, debits and net cash.
- All server calls go through `src/data/api/contract.ts`. Today it is implemented by an in-app mock (`src/data/api/mock.ts`) that behaves like the `/v1/field` API specified in `docs/core-api-dev-brief.md`. A real HTTP client replaces it once the core team publishes the OpenAPI spec.

Not built yet: ID photo and signature capture for registration, passkeys, device enrolment and remote kill, the real API client, receipts printing, reconciliation views.

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
