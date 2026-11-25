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
- Cash collection capture saved to an on-device outbox, then synced automatically with idempotent delivery. With the real server only savings deposits are offered; the demo also shows share contributions and loan repayments.
- Field member registration: name, gender, date of birth (18+), mobile number, ID type and number, address. Saved to the same on-device outbox and synced idempotently as a draft for office approval. The member has no member number and cannot transact until approved. The mock refuses a duplicate ID number. ID photo and signature capture are not built yet.
- Sync screen, "my customers" and frequent members, and provisional daily credits, debits and net cash.
- All server calls go through `src/data/api/contract.ts`. There are two implementations: `http.ts`, the real client for the field server (see `docs/core-integration.md`), and `mock.ts`, demo data that behaves like the fuller API in `docs/core-api-dev-brief.md`. Set `EXPO_PUBLIC_API_URL` to use the real one; without it the app shows a "Demo mode" banner.
- Features the core cannot do yet (share contributions, loan repayments, member registration, SMS code) are switched off by `capabilities` and hidden in the app until the core supports them.

Not built yet: ID photo and signature capture for registration, passkeys, showing the office's decision back to the banker, receipts printing, reconciliation views.

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
