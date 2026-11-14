# QSS Field: Mobile Banker App
## Requirements Specification (v1.0, for supervisor review)

**Product:** a mobile app for field officers (mobilizers) of the QSS core banking system.
**Positioning:** a new service (channel) of the existing core banking platform, not a standalone product. It uses the same database, security, approval and finance rules as the office web application.

---

## 1. Purpose

Mobilizers collect money and register members in the field. The app lets them capture the work on the spot, even without network, and sync it to the core banking system, where it waits for office review, approval and reconciliation exactly like any other input.

**Guiding principle:** the app *captures*; the core system *decides and posts*. Nothing keyed in the field changes a member's balance or the ledger until it is approved and reconciled in the office.

## 2. Scope

**In scope:** member search and summary view, field member registration, deposits to savings, share contributions, loan repayments, SMS notification to the member, personal metrics, offline operation with automatic sync, device tracking and activity logging.

**Out of scope for v1:** withdrawals (the field app never pays cash out to members), loan applications and disbursement, account closure, standing orders, staff keying in transactions on a mobilizer's behalf, mobile money and card payments (v1 is cash only), and member self-service.

## 3. Users and access

| Role | What they do |
|---|---|
| Mobilizer / field officer | Uses the app: captures collections, registers members, sees own metrics |
| Supervisor / manager | Enrols devices, assigns members, reviews and approves staged work |
| Teller / accountant | Reviews, reconciles and settles field collections |
| Administrator / auditor | Oversight and audit across branches |

Access is **per user**. Each mobilizer logs in as themselves; every action is tied to that person, their registered device and their branch.

**Two separate account types.** Mobilizers are *field accounts*, separate from core banking *staff accounts*. A mobilizer does not need a staff account, and a staff member does not get field access automatically. Each account type has its own credentials, login and session. Some people hold both; in that case the two accounts are **linked** (a record of identity only, with no shared credentials or sessions) so the system can treat them as one person for separation-of-duties checks (see FA-3).

---

## 4. Functional requirements

| ID | Requirement |
|---|---|
| **FR-1** | **Per-user access.** Each mobilizer has an individual **field account**, separate from core banking staff accounts. The mobilizer's identity and device come from the signed-in session, never from a value typed into the app. Staff cannot key in field transactions on a mobilizer's behalf (no desk entry). |
| **FR-1a** | **Account creation and enrolment.** A supervisor creates the field account (with a reason and a cash limit). The system issues a one-time enrolment code. The mobilizer installs the app, enters their staff ID and the code, verifies with an OTP sent by SMS, and sets a password. The device registers as untrusted until a supervisor approves it. Staff accounts continue to be created in the core system as today. When one person needs both, an administrator can create both and link them. |
| **FR-1b** | **Sign-in.** First sign-in on a device uses password plus OTP, after which a **passkey** is created on the device. Every later sign-in uses the passkey (device biometric or screen lock). Password plus OTP is needed again only on a new device or after the passkey is revoked. **Offline:** a passkey is verified by the server, so it needs a connection. The app therefore unlocks locally with the device biometric or screen lock so the mobilizer can keep capturing offline, and completes the passkey sign-in with the server when it next syncs. Offline capture is limited by NFR-5 (cap on unsynced items) and stops when the offline period exceeds the limit set by the supervisors. |
| **FR-2** | **Member search.** A mobilizer can search and select **any member of their branch** by name, member number or phone. Access goes through the core API, never directly to the database. Every member lookup is audit-logged. |
| **FR-3** | **Member 360 summary.** One screen shows a summarized member view: personal details, KYC status, balances across savings, shares and loans, loan status and recent transactions. It is clearly labelled "as of last sync" when viewed offline. |
| **FR-4** | **Field registration.** A mobilizer can register a new member in the field (details, ID, photo, location). The record syncs to the office with status **Pending Approval** and follows the normal member approval process. The mobilizer cannot activate a member. |
| **FR-5** | **Deposits and share contributions.** A mobilizer can key in cash deposits into a member's **savings** products and **share contributions** into a member's shares. |
| **FR-6** | **Balance view before keying.** The member's current balances are shown before the amount is entered, so the mobilizer can confirm they are collecting for the right account. |
| **FR-7** | **SMS alert to the member.** After the entry reaches the core system, the member receives an SMS stating the amount received and the status **"pending approval"**. It uses the SMS route already configured in the core banking system. |
| **FR-8** | **Loan repayments.** A mobilizer can key in loan repayments. The split between principal, interest and penalty is calculated by the core system at posting, not on the phone. |
| **FR-9** | **Personal metrics.** A mobilizer sees their own day-by-day activity, controlled by a date selector (default: today): transactions keyed, **total credits, total debits, net cash**, number of members registered, and the status of each item (pending, approved, posted, rejected). **Credits** are all money received (savings deposits, share contributions, loan repayments). **Debits** are credits later reversed or rejected by the office. **Net cash** is credits minus debits, the money that actually stands. |
| **FR-10** | **"My Customers."** A mobilizer can mark members as *my customers* for quick access. The app also suggests members they transact with most often. This list is a personal shortcut and **does not change** the official member assignment or commission. |
| **FR-11** | **Rejections and corrections.** If the office rejects or fails an item, the mobilizer sees the reason and can resubmit a corrected entry. |
| **FR-12** | **Receipt.** Each collection produces a provisional receipt for the member, marked as pending approval. |

> **All field activity is seeded into the core database on sync and awaits approval, and is treated exactly like any other input made in the system.**

---

## 5. Finance and accounting requirements

| ID | Requirement |
|---|---|
| **FA-1** | Keyed-in transactions **do not post to any ledger or member account** until they are **approved and reconciled**. |
| **FA-2** | Lifecycle: **Received → Approved → Reconciled → Posted** (or Rejected / Failed). Only a reconciled, approved item can be posted. |
| **FA-3** | Approval is by a different **person** from the one who captured the item (maker/checker). A mobilizer never approves anything. If a person holds both a field account and a staff account, the link between them is used so they cannot capture an item as a mobilizer and then approve or reconcile it as staff. The same rule applies to reconciliation approval. |
| **FA-4** | Reconciliation compares the cash the mobilizer hands in against the expected total of their staged items. A reconciliation with a variance cannot be approved until investigated. |
| **FA-5** | Posting goes through the existing teller, loan and share posting services, so every existing control applies: period and end-of-day locks, account holds, debit limits, member-status checks and approval thresholds. |
| **FA-6** | Items that cannot be posted (closed period, inactive member, failed rule) go to an **exception queue** for office action instead of being lost. |
| **FA-7** | Money is handled as exact decimal amounts in GHS. Posted records are never edited; corrections are approved reversing entries. |
| **FA-8** | Commission is calculated only on **posted** transactions. |
| **FA-9** | Each mobilizer has a cash limit and a ceiling on unreconciled cash. Beyond it, the app blocks further collections until a reconciliation is done. |

**Business note.** Because a member's balance changes only after reconciliation, a member may see an SMS saying "pending approval" before their balance moves. The member view in the office should show these as *pending deposits*, separate from the available balance.

---

## 6. Non-functional requirements

| ID | Requirement |
|---|---|
| **NFR-1** | **Authentication.** Passwords are stored only as salted hashes on the server, never in readable or reversible form. Passkeys store only a public key on the server; the private key never leaves the device. OTPs are single-use, short-lived and sent over the existing SMS route. All traffic uses TLS. Data on the device is encrypted. Field accounts lock after repeated failures. Field sessions have their own idle and absolute limits, suited to offline work. A field token is rejected by staff endpoints, and a staff token is rejected by field endpoints. |
| **NFR-2** | **Device tracking.** Every mobilizer device is registered and tracked on the core banking platform (device ID, model, OS and app version, trusted status, last seen). A supervisor can suspend a lost or stolen device remotely. |
| **NFR-3** | **Activity logging.** Login time, last active time, logout time and sync results are logged and synced to the core system. The server records its own receive time alongside the device time. |
| **NFR-4** | **Fast and smooth.** The app must feel instant in daily use. Targets (to be validated on the oldest field phone): app opens in under 3 seconds; member search results within 1 second from the local cache and within 2 seconds online; saving a transaction instant (local save, no waiting for the network); scrolling and screen transitions without visible lag; modest installed size and memory use. |
| **NFR-5** | **Offline-first.** All inputs are saved on the device when there is no network and sync automatically when connectivity returns. The app shows what is waiting to sync, and a cap on unsynced items limits exposure if a phone is lost. |
| **NFR-6** | **Idempotency.** Each entry carries a unique identifier so a retry, a double tap or a repeated sync can never create a duplicate. If a retry arrives with different details, it is flagged rather than overwritten. |
| **NFR-7** | **Security of data on device.** Cached member data is encrypted and limited to what is needed, and is wiped on logout, device suspension or remote kill. No personal data in logs. |
| **NFR-8** | **Auditability.** Every capture, sync, review, approval, rejection and posting is recorded with who, when and from which device. |
| **NFR-9** | **Availability of the core.** A failure of SMS or messaging must never block or roll back a collection. |

---

## 7. How it fits the existing system

**Delivery boundary.** The field app is built in its own project and repository. The core banking system (`cua-core-api`) is changed only by the core banking team; the field app team works against a staging API and its published OpenAPI contract and does not modify or push to the core repository.

The core banking API already contains a mobile-banking module (mobile bankers, device registry, member assignments, field transaction staging, reconciliation, commission). The project builds on it:

| Need | Status in the core system |
|---|---|
| Mobile banker, device and assignment management | Exists |
| Staging of cash deposits with approval | Exists (the existing intake also accepts withdrawals; the field channel must block them) |
| Reconciliation with variance control | Exists |
| Idempotent, duplicate-proof intake | Exists |
| SMS gateway | Exists (field-specific trigger and template to be added) |
| Posting of approved field items to ledger / accounts | **To build** (settlement step) |
| Loan repayment, share contribution and registration through the field channel | **To build** |
| Mobile-facing API (sync, member summary, personal metrics) | **To build** |
| Separate field identity: credentials, enrolment code, OTP, passkey sign-in, field token and guard | **To build** (the officer record exists but nothing authenticates it today) |
| Link between field and staff accounts, used for separation of duties | **To build** |
| Binding each field session to its officer and device (identity taken from the session, not the request) | **To build** (security hardening) |
| Audit records that identify field actors (today they hold a staff user ID only) | **To build** |

## 8. Decisions recorded

| # | Question | Decision |
|---|---|---|
| 1 | Which members can a mobilizer search? | **All members of the branch** (read-only summary, every lookup audited). |
| 2 | Are withdrawals in scope? | **No.** Removed entirely from v1; the app only receives money. |
| 3 | How are "my customers" chosen? | **Self-selected and most frequent.** Personal shortcut only; official assignment and commission are unchanged. |
| 4 | What does "light" mean? | **Smooth and fast to use** (targets in NFR-4). |
| 5 | Mobile money | **Out of scope for now.** v1 is cash only. |
| 6 | SMS route and trigger | **Use the existing SMS route** of the core banking system. Sent after the entry reaches the core system. |
| 7 | Sign-in method | **Password plus OTP on first sign-in on a device, then a passkey** for every later sign-in. |
| 8 | Can staff key in transactions for a mobilizer? | **No.** Desk entry is removed; field transactions come only from the mobilizer's own field session. |
| 9 | Are field and staff accounts linked? | **Yes**, whenever one person holds both, and it is enforced where the same staff ID or phone number appears on both. |

## 9. Open items for supervisor decision

1. **Is the member balance updated only after reconciliation?** The requirement says yes. Confirm the business is comfortable with the delay and the "pending deposits" display.
2. **Which roles approve and settle?** Teller, supervisor, accountant, or a combination.
3. **Items arriving after end-of-day closure.** Post to the next open day, or hold for manual decision?
4. **Minimum phone specification** and Android only versus Android plus iOS.
5. **SMS cost control.** Per-member daily limit and who bears the cost.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Lost or stolen phone | Device binding, PIN and biometric lock, encrypted storage, remote suspend and wipe, cap on unsynced items |
| Cash handled in the field | Cash limits, reconciliation, variance control, GPS capture, receipts |
| Duplicate or fraudulent entries | Idempotency keys, maker/checker, velocity and duplicate checks, audit trail |
| Stale balances offline | "As of last sync" label; server validates at posting |
| Member confusion over pending status | SMS wording and pending-deposit display |
| Late syncs into closed periods | Exception queue and policy decision (open item 3) |
| One person with both a field and a staff account captures and approves their own work | Link between the accounts, and approval checks that compare people, not accounts |
| A field token used on staff functions, or the reverse | Separate token types, and each side rejects the other's |

## 11. Proposed delivery phases

| Phase | Outcome |
|---|---|
| 1. Field identity and security hardening | Separate field accounts, enrolment, OTP and passkey sign-in, field token, account link, identity taken from the session, restricted reads and approvals |
| 2. Settlement | Approved and reconciled items post through existing teller and loan services |
| 3. Field API | Sync, member summary, personal metrics, SMS trigger |
| 4. Loan repayments, shares and registration | Full field coverage |
| 5. Mobile app | Offline-first app on field devices |
| 6. Office screens | Settlement and exception queues, device and banker dashboards |
| 7. Pilot | One branch, a few mobilizers, daily reconciliation |

## 12. Acceptance criteria (summary)

- A deposit keyed offline appears in the office queue after sync, exactly once, even if sync is retried.
- No ledger entry or balance change exists for any field item before approval and reconciliation.
- The member receives a "pending approval" SMS through the existing SMS route.
- A mobilizer sees only their own metrics; credits, debits (reversed or rejected items) and net cash match the office's staged data for the same date.
- A mobilizer cannot approve their own work or another mobilizer's reconciliation.
- A person who holds both a field account and a staff account cannot approve or reconcile an item they captured.
- A field token is rejected on staff endpoints, and a staff token is rejected on field endpoints.
- A new device cannot sign in with a passkey until the mobilizer has completed password plus OTP and a supervisor has approved the device.
- A suspended device cannot sync and its local data is wiped on next contact.
- A field-registered member cannot transact until approved in the office.
