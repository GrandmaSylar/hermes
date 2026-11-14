# Brief for the cua-core-api developer: provisions for the QSS Field mobile app

**Audience:** the developer of the core banking web app and API (`cua-core-api`).
**Companion document:** `cableee.md` (requirements specification).
**Boundary:** the field app is built in a **separate project and repository** by a separate team. Nothing in this brief is done by the field app team inside `cua-core-api`. These are the changes the core team needs to make, and the contract the field team will build against.

---

## 1. Context

We are building a mobile app for field officers (mobilizers). It is a new **channel** of the core system. It captures cash deposits, share contributions, loan repayments and new-member registrations, works offline, and syncs. Everything it sends waits for office approval and reconciliation like any other input. **Nothing posts to a ledger or a member balance until it is approved and reconciled.**

Out of scope for v1: withdrawals, mobile money, card payments, loan applications and disbursement, and staff keying in transactions on a mobilizer's behalf (no desk entry).

## 2. What exists and must stay compatible

`src/mobile-banking/` already has bankers, devices, assignments, field-transaction staging, reconciliation and commission (migrations 038, 053, 054). The app will depend on:

- the `(deviceId, localTransactionId)` unique index and the idempotency-key rule,
- the staged states (`RECEIVED`, `APPROVED_FOR_POSTING`, ...),
- the officer and device registry, and the submitter-not-approver rules.

Please do not rename or restructure these without telling the field team.

## 3. Changes requested

### A. Field identity (new, and the first thing to build)

Field officers are separate from core staff users. They have their own account type, credentials, login and token.

1. **Separate identity.** Authenticate against `fieldOfficers`, not `users`. New endpoints under `/v1/field/auth/*`.
2. **Enrolment.** A supervisor creates the officer (existing `POST /mobile-banking/bankers`, with reason and cash limit). The system issues a **one-time enrolment code**. The mobilizer enters staff ID and code in the app, verifies an **SMS OTP** (existing SMS route), and sets a password. The device registers as untrusted until a supervisor approves it (existing device flow).
3. **Sign-in.** First sign-in on a device: password + OTP, then create a **passkey** (WebAuthn). Later sign-ins: passkey. Password + OTP again only on a new device or after the passkey is revoked. No passkey (WebAuthn) support was found in the identity module, so this is new work; the server stores only public keys.
4. **Field token.** A separate JWT type (for example `typ=field`) with claims `officerId`, `deviceId`, `branchCode`, `sessionId`. New `FieldAuthGuard`. **`JwtAuthGuard` must reject field tokens and `FieldAuthGuard` must reject staff tokens**, so a token can never be replayed on the wrong side.
5. **Identity from the session.** `officerId` and `deviceId` come from the field token and are no longer accepted in request bodies. This closes the current gap where `intakeTransaction` trusts the body's `officerId`.
6. **Own lockout and session policy.** Failure counters on the officer record, and idle and absolute session limits suited to offline work (separate from the staff policy). The staff IP allow-list must not apply to field sessions (carrier IPs); device binding compensates.
7. **Remote kill.** Suspending a device or officer revokes the session family, and the app wipes local data on next contact.
8. **Link to staff accounts.** Add a nullable `linkedUserId` on `fieldOfficers` for people who hold both accounts. It carries no credentials or sessions. Enforce it where the same staff ID or phone number appears on both accounts.
9. **Separation of duties across the link.** Maker/checker and reconciliation approval must compare **people**: an approving staff user's `userId` must not equal the submitting officer's `linkedUserId`.
10. **Audit.** Audit rows hold `actorUserId` (a number) today. Add `actorType` (`STAFF` or `FIELD`) and `actorId` so field actions are attributed correctly.
11. **Provisioning.** Staff accounts continue as today (`POST /identity/users`). Offer an admin action that can create both and link them, still as two records. Disabling one account must not silently disable the other; show the link and prompt for both.

### B. Hardening of the existing module

12. Reads for field officers filter by the token's `officerId` (today a mobile banker can read every banker's data in the branch).
13. `MOBILE BANKER` and `FIELD OFFICER` roles must not be able to approve or reject reconciliations.
14. Validate at intake that the device belongs to the calling session, and that the member is a valid branch member.
15. Enforce the officer's cash limit and add a ceiling on unreconciled cash.
16. Add idempotency keys to the commission endpoints.
17. Remove the staff "key in for an officer" path (no desk entry).

### C. Settlement: the missing bridge

18. Post an item only when it is **approved and its officer reconciliation is approved**. Use the existing teller (savings), share purchase and loan repayment services inside one transaction, so period and end-of-day locks, holds, debit limits, member-status checks and approval thresholds all apply.
19. New states (for example `RECONCILED`, `POSTED`, `FAILED_POSTING`) and an **exception queue** for closed periods, inactive members and failed rules.
20. Link each staged item to the reconciliation that covers it.
21. Decide with finance whether each officer needs a till or float account so collected cash has a ledger home.
22. Commission counts only `POSTED` items.

### D. Extend intake

23. Add a product type to staged items: savings deposit, share contribution, loan repayment. **Block withdrawals** for the field channel (the current intake accepts them). Loan allocation (principal, interest, penalty) is computed at posting, not on the phone.
24. Field registration enters the existing member draft → approval flow with `source=FIELD`. A field-registered member cannot transact until approved.
25. Record why and against what an item was rejected or reversed. The app's "debits" metric means credits later rejected or reversed by the office.
26. Reconciliation is cash only in v1. Leave the mobile-money field at zero.

### E. New `/v1/field` surface (the contract the app builds against)

27. Sync: batch push with a per-item result, and cursor-based pull.
28. Lean member search (any member of the officer's branch) and one member-summary endpoint (personal details, KYC status, balances across savings, shares and loans, recent transactions). Every lookup audit-logged.
29. "My summary" by date range: total credits, total debits, net cash, members registered, and counts by status.
30. "My customers": a personal list per officer (self-selected, plus frequent members). It does not change official assignment or commission.
31. Session events (login, last active, logout, sync result) with the server receive time stored beside the device time.
32. A stable **OpenAPI spec**. The app generates its client from it, so changes need notice.

### F. SMS

33. A field-specific trigger and template through the existing `sms` gateway, sent **after the item reaches the core**, never inside the posting transaction. An SMS or messaging failure must never block or roll back a collection. Add a per-member rate limit and a consent check.

### G. Office screens (web app)

34. Settlement and exception queues, a device and officer dashboard, remote device suspend, and a "pending deposits" line in the member view, separate from the available balance.

## 4. Policies to preserve

- Idempotency key on every money write. Posted records are never edited; corrections are approved reversals.
- Period and end-of-day locks, account holds, member-status checks, debit limits, approval thresholds. Settlement must go through the same services as the teller.
- Branch scope, maker/checker, audit and transactional outbox on every state change.
- Decimal amounts as strings. GHS only.
- No personal data in logs or metrics.

## 5. Decisions needed from the business

1. Who approves, and who settles (teller, supervisor, accountant)?
2. Items synced after end-of-day closure: post to the next open day, or hold for a decision?
3. Does each officer need a till or float account, and on which ledger accounts?
4. SMS cost control: per-member daily limit, and who bears the cost.
5. Phone platform: Android only, or Android plus iOS.
6. Maximum offline period and unsynced-item cap per officer.

## 6. Suggested order

1. Field identity (A) and hardening (B). Both are needed before any money flows.
2. Intake extension (D) and the `/v1/field` surface (E), so the app team can start against **staging**.
3. Settlement (C), SMS (F) and the office screens (G).

## 7. Practical needs

- A **staging environment with its own database**. Never run write tests against production.
- Migrations in both styles the repo uses (SQL and `migration:mongo:field-*`), with Mongo and MSSQL parity.
- A short notice when the OpenAPI spec changes.

## 8. Caveat

This brief comes from reading the code, not from the live database or the web client. Please confirm table and collection names, which driver production uses, and the gaps in items 5, 12, 13 and 14 before treating them as defects.
