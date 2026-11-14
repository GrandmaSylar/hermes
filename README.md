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

## Run the app

```
cd app
npm install
npm run android      # connected Android phone or emulator
npm run ios          # needs macOS, or build in the cloud with EAS
npm run typecheck
```
