import { ApiError, type ApiClient, type PushItem, type PushRegistration } from '@/data/api/contract';
import type { Repos } from '@/data/repositories';
import type { RegistrationItem } from '@/domain/registration';
import { kindForProduct } from '@/domain/deposit';
import type { OutboxItem, Session } from '@/domain/types';

export interface SyncReport {
  pushed: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  conflicts: number;
  pulledMembers: number;
  /** Registrations delivered to the office (new or already received). */
  registrationsSent: number;
  registrationsRejected: number;
  /** Savings accounts refreshed from the core system. */
  accountsPulled: number;
  /** Collections whose office decision (approved, verified, refused) changed. */
  decisionsUpdated: number;
  /** The core system answered with an error the user cannot fix by retrying immediately. */
  serverError: string | null;
  /** The server could not be reached; items were left waiting. */
  offline: boolean;
  /** The session is no longer valid; the user must sign in again. */
  authError: boolean;
}

export interface SyncDeps {
  repos: Repos;
  api: ApiClient;
  session: Session;
  now?: () => Date;
  /** How long cached member data is trusted before a refresh. */
  memberMaxAgeMs?: number;
  batchSize?: number;
  /** Re-download every member and balance now, ignoring how recent the cached copy is. */
  fullRefresh?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const KV_CURSOR = 'members.cursor';
const KV_PULLED_AT = 'members.pulledAt';
/** Highest member code pulled so far; members are listed in code order, so newer ones follow it. */
const KV_MAX_CODE = 'members.maxCode';
/** The core system's member list has no savings accounts, so they are pulled in a second stage. */
const KV_STAGE = 'pull.stage';
const KV_ACCOUNTS_CURSOR = 'accounts.cursor';
const KV_DECISIONS_SINCE = 'decisions.since';
/** The member types the registration form offers, as last fetched (JSON). */
export const KV_MEMBER_TYPES = 'registration.memberTypes';
/** Look back this far before the last check, so a decision made while the phone was asking is not missed. */
const DECISION_OVERLAP_MS = 10 * 60 * 1000;

let running: Promise<SyncReport> | null = null;

/**
 * Pushes waiting items, then refreshes member data. Only one sync runs at a
 * time; a second call while one is running shares its result.
 *
 * Pushing is idempotent end to end: every item carries its own
 * localTransactionId, so re-sending after a dropped response can only ever
 * produce a DUPLICATE answer, never a second entry.
 */
export function syncOnce(deps: SyncDeps): Promise<SyncReport> {
  if (running) return running;
  running = run(deps).finally(() => {
    running = null;
  });
  return running;
}

function toPushItem(item: OutboxItem): PushItem {
  return {
    // A loan repayment has no deposit kind; the SAVINGS here is never sent (the client refuses it).
    kind: kindForProduct(item.productType) ?? 'SAVINGS',
    paymentMode: item.paymentMode,
    localTransactionId: item.localTransactionId,
    memberCode: item.memberCode,
    productType: item.productType,
    amount: item.amount,
    reference: item.reference,
    collectedAt: item.collectedAt,
    accountId: item.accountId,
  };
}

async function run(deps: SyncDeps): Promise<SyncReport> {
  const report: SyncReport = {
    pushed: 0,
    accepted: 0,
    duplicates: 0,
    rejected: 0,
    conflicts: 0,
    pulledMembers: 0,
    registrationsSent: 0,
    registrationsRejected: 0,
    accountsPulled: 0,
    decisionsUpdated: 0,
    serverError: null,
    offline: false,
    authError: false,
  };
  const { repos, api, session } = deps;
  const batchSize = deps.batchSize ?? 50;

  try {
    await repos.outbox.recoverInterrupted();
    await repos.registrations.recoverInterrupted();

    // Registration is offered only when the server says it can take it. Until then registrations wait safely on the phone.
    await refreshRegistration(deps);
    if (api.capabilities.registration) await pushRegistrations(deps, report, batchSize);

    for (;;) {
      const batch = await repos.outbox.due(batchSize);
      if (batch.length === 0) break;
      const ids = batch.map((item) => item.localTransactionId);
      await repos.outbox.markSending(ids);

      let results;
      try {
        results = await api.pushTransactions(session, batch.map(toPushItem));
      } catch (error) {
        await repos.outbox.release(ids);
        throw error;
      }

      const answered = new Set<string>();
      for (const result of results) {
        answered.add(result.localTransactionId);
        report.pushed += 1;
        switch (result.status) {
          case 'ACCEPTED':
            report.accepted += 1;
            await repos.outbox.applyResult(result.localTransactionId, 'SYNCED', { serverId: result.serverId ?? null, lastError: null });
            break;
          case 'DUPLICATE':
            report.duplicates += 1;
            await repos.outbox.applyResult(result.localTransactionId, 'SYNCED', { serverId: result.serverId ?? null, lastError: null });
            break;
          case 'REJECTED':
            report.rejected += 1;
            await repos.outbox.applyResult(result.localTransactionId, 'REJECTED', { lastError: result.reason ?? 'Rejected.' });
            break;
          case 'CONFLICT':
            report.conflicts += 1;
            await repos.outbox.applyResult(result.localTransactionId, 'CONFLICT', { lastError: result.reason ?? 'Conflict.' });
            break;
        }
      }
      // Anything the server did not answer for goes back to waiting.
      const unanswered = ids.filter((id) => !answered.has(id));
      if (unanswered.length > 0) {
        await repos.outbox.release(unanswered);
        break;
      }
    }

    await pullDecisions(deps, report);
    await pullMembersIfStale(deps, report);
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'NETWORK') report.offline = true;
    else if (error instanceof ApiError && error.kind === 'AUTH') report.authError = true;
    else if (error instanceof ApiError) report.serverError = error.message;
    else throw error;
  }
  return report;
}

/**
 * Asks the server what the office has decided about collections already sent.
 * Skipped when nothing is waiting on the office, so an idle phone makes no call.
 */
async function pullDecisions(deps: SyncDeps, report: SyncReport): Promise<void> {
  const { repos, api, session } = deps;
  if (!api.capabilities.officeDecisions) return;
  if ((await repos.outbox.awaitingDecision()) === 0) return;

  const now = (deps.now ?? (() => new Date()))();
  const stored = await repos.kv.get(KV_DECISIONS_SINCE);
  const decisions = await api.pullDecisions(session, stored);
  report.decisionsUpdated += await repos.outbox.applyOfficeDecisions(decisions);
  await repos.kv.set(KV_DECISIONS_SINCE, new Date(now.getTime() - DECISION_OVERLAP_MS).toISOString());
}

/** The form as the server takes it. The ids on the item win, so a retry is always recognised. */
function toPushRegistration(r: RegistrationItem & { payload: NonNullable<RegistrationItem['payload']> }): PushRegistration {
  return { ...r.payload, localRegistrationId: r.localRegistrationId, capturedAt: r.capturedAt };
}

/** Asks the server whether registration is on, and keeps its member types for the form to use offline. A failure changes nothing. */
async function refreshRegistration(deps: SyncDeps): Promise<void> {
  const { repos, api, session } = deps;
  try {
    await api.refreshCapabilities?.(session);
    if (api.capabilities.registration) {
      const types = await api.memberTypes(session);
      if (types.length > 0) await repos.kv.set(KV_MEMBER_TYPES, JSON.stringify(types));
    }
  } catch (error) {
    // Offline or a server hiccup: what was known before still stands. A rejected session still ends the sync.
    if (error instanceof ApiError && error.kind === 'AUTH') throw error;
  }
}

/** Same delivery rules as collections: idempotent, resumable, and never lost on a network failure. */
async function pushRegistrations(deps: SyncDeps, report: SyncReport, batchSize: number): Promise<void> {
  const { repos, api, session } = deps;
  for (;;) {
    const due = await repos.registrations.due(batchSize);
    if (due.length === 0) return;
    // A registration saved by an older version of the app has no form to send: tell the banker to redo it.
    const old = due.filter((r) => r.payload === null);
    for (const r of old) {
      report.registrationsRejected += 1;
      await repos.registrations.applyResult(r.localRegistrationId, 'REJECTED', {
        lastError: 'Saved by an older version of the app and never sent. Register this member again.',
      });
    }
    const batch = due.filter((r): r is RegistrationItem & { payload: NonNullable<RegistrationItem['payload']> } => r.payload !== null);
    if (batch.length === 0) continue;
    const ids = batch.map((r) => r.localRegistrationId);
    await repos.registrations.markSending(ids);

    let results;
    try {
      results = await api.pushRegistrations(session, batch.map(toPushRegistration));
    } catch (error) {
      await repos.registrations.release(ids);
      throw error;
    }

    const answered = new Set<string>();
    for (const result of results) {
      answered.add(result.localRegistrationId);
      switch (result.status) {
        case 'ACCEPTED':
        case 'DUPLICATE':
          report.registrationsSent += 1;
          await repos.registrations.applyResult(result.localRegistrationId, 'SYNCED', {
            serverId: result.serverId ?? null,
            lastError: null,
          });
          break;
        case 'REJECTED':
          report.registrationsRejected += 1;
          await repos.registrations.applyResult(result.localRegistrationId, 'REJECTED', { lastError: result.reason ?? 'Rejected.' });
          break;
        case 'CONFLICT':
          report.registrationsRejected += 1;
          await repos.registrations.applyResult(result.localRegistrationId, 'CONFLICT', { lastError: result.reason ?? 'Conflict.' });
          break;
      }
    }
    const unanswered = ids.filter((id) => !answered.has(id));
    if (unanswered.length > 0) {
      await repos.registrations.release(unanswered);
      return;
    }
  }
}

async function pullMembersIfStale(deps: SyncDeps, report: SyncReport): Promise<void> {
  const { repos, api, session } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const maxAge = deps.memberMaxAgeMs ?? DAY_MS;

  const pulledAt = await repos.kv.get(KV_PULLED_AT);
  let stage = (await repos.kv.get(KV_STAGE)) || 'members';
  let cursor = (await repos.kv.get(KV_CURSOR)) || null;
  if (deps.fullRefresh) {
    // Start over from the first member, even if an earlier download was half done.
    stage = 'members';
    cursor = null;
    await repos.kv.set(KV_CURSOR, '');
  }
  const fresh = !deps.fullRefresh && pulledAt !== null && now.getTime() - new Date(pulledAt).getTime() < maxAge;
  if (fresh && stage === 'members' && cursor === null) {
    // Cached data is trusted, but members added since are cheap to fetch: only the ones after the last known code.
    await pullNewMembers(deps, report);
    return;
  }

  // Stage 1: members. Progress is remembered so an interrupted pull resumes instead of restarting.
  if (stage === 'members') {
    for (;;) {
      const page = await api.pullMembers(session, cursor);
      await repos.members.upsertMany(page.items);
      report.pulledMembers += page.items.length;
      await rememberMaxCode(repos, page.items);
      cursor = page.nextCursor;
      await repos.kv.set(KV_CURSOR, cursor ?? '');
      if (cursor === null) break;
    }
    stage = 'accounts';
    await repos.kv.set(KV_STAGE, stage);
    await repos.kv.set(KV_ACCOUNTS_CURSOR, '');
  }

  // Stage 2: each member's savings account id and balance.
  let accountsCursor = (await repos.kv.get(KV_ACCOUNTS_CURSOR)) || null;
  for (;;) {
    const page = await api.pullSavingsAccounts(session, accountsCursor);
    await repos.members.applySavingsAccounts(page.items);
    report.accountsPulled += page.items.length;
    accountsCursor = page.nextCursor;
    await repos.kv.set(KV_ACCOUNTS_CURSOR, accountsCursor ?? '');
    if (accountsCursor === null) break;
  }
  await repos.kv.set(KV_STAGE, 'members');
  await repos.kv.set(KV_PULLED_AT, now.toISOString());
}

async function rememberMaxCode(repos: Repos, items: { memberCode: string }[]): Promise<void> {
  if (items.length === 0) return;
  const last = items[items.length - 1].memberCode;
  const known = await repos.kv.get(KV_MAX_CODE);
  if (!known || Number(last) > Number(known)) await repos.kv.set(KV_MAX_CODE, last);
}

/** Fetches only members newer than the highest code already on the phone. A failure here never blocks the sync. */
async function pullNewMembers(deps: SyncDeps, report: SyncReport): Promise<void> {
  const { repos, api, session } = deps;
  // A phone that downloaded its list before this was tracked has no stored value: use the highest code it holds.
  let cursor = (await repos.kv.get(KV_MAX_CODE)) || (await repos.members.maxCode());
  if (cursor === null) return;
  try {
    for (;;) {
      const page = await api.pullMembers(session, cursor);
      await repos.members.upsertMany(page.items);
      report.pulledMembers += page.items.length;
      await rememberMaxCode(repos, page.items);
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
  } catch {
    // Offline or a server hiccup: the cached list is still good, and the next sync tries again.
  }
}
