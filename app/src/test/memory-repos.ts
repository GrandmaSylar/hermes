import type { OfficeDecision, SavingsAccountInfo, ServerMember } from '@/data/api/contract';
import type {
  KvRepo,
  MemberRepo,
  NewOutboxItem,
  NewRegistration,
  OutboxRepo,
  RegistrationRepo,
  Repos,
} from '@/data/repositories';
import type { UnsyncedTotals } from '@/domain/capture';
import type { RegistrationItem } from '@/domain/registration';
import { toMinor } from '@/domain/money';
import type { Member, OutboxItem, OutboxStatus } from '@/domain/types';

/** In-memory storage used by unit tests, with the same behaviour as the SQLite repos. */

class MemoryMembers implements MemberRepo {
  readonly rows = new Map<string, Member>();

  async upsertMany(members: ServerMember[]) {
    for (const m of members) {
      const old = this.rows.get(m.memberCode);
      this.rows.set(m.memberCode, {
        ...m,
        savingsAccountId: m.savingsAccountId ?? old?.savingsAccountId ?? null,
        // A refresh replaces the member's accounts, so a closed account disappears.
        accounts: { savings: m.accounts.savings.map((a) => ({ ...a })), shares: m.accounts.shares.map((a) => ({ ...a })) },
        myCustomer: old?.myCustomer ?? false,
        collectCount: old?.collectCount ?? 0,
      });
    }
  }
  async search(query: string, limit: number) {
    const q = query.trim().toLowerCase();
    return [...this.rows.values()]
      .filter((m) => q === '' || `${m.memberCode} ${m.name} ${m.phone}`.toLowerCase().includes(q))
      .slice(0, limit);
  }
  async get(code: string) {
    return this.rows.get(code) ?? null;
  }
  async count() {
    return this.rows.size;
  }
  async applySavingsAccounts(accounts: SavingsAccountInfo[]) {
    for (const a of accounts) {
      const m = this.rows.get(a.memberCode);
      if (m && (m.savingsAccountId === null || m.savingsAccountId >= a.accountId)) {
        m.savingsAccountId = a.accountId;
        m.balances = { ...m.balances, savings: a.balance };
      }
    }
  }
  async setMyCustomer(code: string, value: boolean) {
    const m = this.rows.get(code);
    if (m) m.myCustomer = value;
  }
  async bumpCollectCount(code: string) {
    const m = this.rows.get(code);
    if (m) m.collectCount += 1;
  }
  async mine(limit: number) {
    return [...this.rows.values()].filter((m) => m.myCustomer).slice(0, limit);
  }
  async frequent(limit: number) {
    return [...this.rows.values()]
      .filter((m) => m.collectCount > 0 && !m.myCustomer)
      .sort((a, b) => b.collectCount - a.collectCount)
      .slice(0, limit);
  }
}

class MemoryOutbox implements OutboxRepo {
  readonly rows = new Map<string, OutboxItem>();

  async enqueue(item: NewOutboxItem) {
    // Same as INSERT OR IGNORE on the primary key.
    if (this.rows.has(item.localTransactionId)) return;
    this.rows.set(item.localTransactionId, {
      ...item,
      status: 'PENDING',
      attempts: 0,
      lastError: null,
      serverId: null,
      officeStatus: null,
      officeReason: null,
      officeDecidedAt: null,
    });
  }
  async list(limit: number) {
    return [...this.rows.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }
  async due(limit: number) {
    return [...this.rows.values()]
      .filter((i) => i.status === 'PENDING')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit);
  }
  async recoverInterrupted() {
    for (const i of this.rows.values()) if (i.status === 'SENDING') i.status = 'PENDING';
  }
  async markSending(ids: string[]) {
    for (const id of ids) {
      const i = this.rows.get(id);
      if (i) {
        i.status = 'SENDING';
        i.attempts += 1;
      }
    }
  }
  async applyResult(id: string, status: OutboxStatus, patch: { serverId?: string | null; lastError?: string | null }) {
    const i = this.rows.get(id);
    if (!i) return;
    i.status = status;
    i.serverId = patch.serverId ?? i.serverId;
    i.lastError = patch.lastError ?? null;
  }
  async release(ids: string[]) {
    for (const id of ids) {
      const i = this.rows.get(id);
      if (i && i.status === 'SENDING') i.status = 'PENDING';
    }
  }
  async unsyncedTotals(): Promise<UnsyncedTotals> {
    const open = [...this.rows.values()].filter((i) => i.status === 'PENDING' || i.status === 'SENDING');
    return { count: open.length, amountMinor: open.reduce((s, i) => s + toMinor(i.amount), 0n) };
  }
  async awaitingDecision() {
    return [...this.rows.values()].filter(
      (i) => i.status === 'SYNCED' && (i.officeStatus === null || i.officeStatus === 'PENDING' || i.officeStatus === 'APPROVED'),
    ).length;
  }
  async applyOfficeDecisions(decisions: OfficeDecision[]) {
    let changed = 0;
    for (const d of decisions) {
      const i = this.rows.get(d.localTransactionId);
      if (!i || i.status !== 'SYNCED') continue;
      if (i.officeStatus === d.status && i.officeReason === d.reason && i.officeDecidedAt === d.decidedAt) continue;
      i.officeStatus = d.status;
      i.officeReason = d.reason;
      i.officeDecidedAt = d.decidedAt;
      changed += 1;
    }
    return changed;
  }
  async forDay(day: string) {
    return [...this.rows.values()].filter((i) => i.collectedAt.slice(0, 10) === day);
  }
}

class MemoryRegistrations implements RegistrationRepo {
  readonly rows = new Map<string, RegistrationItem>();

  async enqueue(item: NewRegistration) {
    if (this.rows.has(item.localRegistrationId)) return;
    this.rows.set(item.localRegistrationId, { ...item, status: 'PENDING', attempts: 0, lastError: null, serverId: null });
  }
  async list(limit: number) {
    return [...this.rows.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }
  async due(limit: number) {
    return [...this.rows.values()]
      .filter((r) => r.status === 'PENDING')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit);
  }
  async recoverInterrupted() {
    for (const r of this.rows.values()) if (r.status === 'SENDING') r.status = 'PENDING';
  }
  async markSending(ids: string[]) {
    for (const id of ids) {
      const r = this.rows.get(id);
      if (r) {
        r.status = 'SENDING';
        r.attempts += 1;
      }
    }
  }
  async applyResult(id: string, status: OutboxStatus, patch: { serverId?: string | null; lastError?: string | null }) {
    const r = this.rows.get(id);
    if (!r) return;
    r.status = status;
    r.serverId = patch.serverId ?? r.serverId;
    r.lastError = patch.lastError ?? null;
  }
  async release(ids: string[]) {
    for (const id of ids) {
      const r = this.rows.get(id);
      if (r && r.status === 'SENDING') r.status = 'PENDING';
    }
  }
  async waitingCount() {
    return [...this.rows.values()].filter((r) => r.status === 'PENDING' || r.status === 'SENDING').length;
  }
  async hasIdNumber(idNumber: string) {
    return [...this.rows.values()].some((r) => r.idNumber === idNumber && r.status !== 'REJECTED');
  }
  async forDay(day: string) {
    return [...this.rows.values()].filter((r) => r.capturedAt.slice(0, 10) === day);
  }
}

class MemoryKv implements KvRepo {
  readonly rows = new Map<string, string>();
  async get(key: string) {
    return this.rows.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.rows.set(key, value);
  }
}

export interface MemoryRepos extends Repos {
  members: MemoryMembers;
  outbox: MemoryOutbox;
  registrations: MemoryRegistrations;
  kv: MemoryKv;
}

export function createMemoryRepos(): MemoryRepos {
  return {
    members: new MemoryMembers(),
    outbox: new MemoryOutbox(),
    registrations: new MemoryRegistrations(),
    kv: new MemoryKv(),
  };
}
