import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Config } from './config';
import { isAmountText, toMinor } from './money';
import type { Officer, Repo } from './repo';
import { Tokens } from './tokens';

export interface AppDeps {
  config: Config;
  repo: Repo;
  now?: () => Date;
}

declare module 'fastify' {
  interface FastifyRequest {
    officer?: Officer;
    deviceId?: string;
  }
}

/** A hash to compare against when the username is unknown, so timing does not reveal who exists. */
const DUMMY_HASH = bcrypt.hashSync('not-a-real-pin', 10);

const loginBody = z.object({
  username: z.string().trim().min(1).max(100),
  pin: z.string().min(1).max(100),
  deviceId: z.string().trim().min(4).max(100),
});

const refreshBody = z.object({ refreshToken: z.string().min(10).max(4000) });

const depositBody = z.object({
  localTransactionId: z.string().regex(/^[A-Za-z0-9_-]{8,46}$/, 'localTransactionId must be 8 to 46 letters, digits, - or _'),
  memberCode: z.string().regex(/^\d{1,10}$/),
  accountId: z.number().int().positive(),
  amount: z.string().refine(isAmountText, 'amount must have at most two decimals'),
  collectedAt: z.string().datetime({ offset: true }),
});

const membersQuery = z.object({
  cursor: z.string().regex(/^\d{1,10}$/).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const depositsQuery = z.object({
  since: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export function mapMemberStatus(statusCode: string, isActive: boolean): 'ACTIVE' | 'PENDING' | 'INACTIVE' {
  const code = statusCode.trim().toUpperCase();
  if (!isActive) return 'INACTIVE';
  if (code === 'ACT' || code === 'ACTIVE') return 'ACTIVE';
  if (code === 'NEW' || code === 'PND') return 'PENDING';
  return 'INACTIVE';
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { config, repo } = deps;
  const now = deps.now ?? (() => new Date());
  const tokens = new Tokens(config.jwtSecret, config.accessTtlSeconds, config.refreshTtlSeconds);
  const failures = new Map<string, { count: number; firstAt: number }>();

  const app = Fastify({ logger: false, bodyLimit: 64 * 1024, trustProxy: true });

  app.register(helmet);
  app.register(rateLimit, { global: true, max: 240, timeWindow: '1 minute' });

  const fail = (reply: FastifyReply, status: number, message: string, extra: Record<string, unknown> = {}) =>
    reply.code(status).send({ message, ...extra });

  const lockedOut = (key: string): number => {
    const f = failures.get(key);
    if (!f) return 0;
    const windowMs = config.pinLockoutMinutes * 60_000;
    const age = now().getTime() - f.firstAt;
    if (age >= windowMs) {
      failures.delete(key);
      return 0;
    }
    return f.count >= config.pinMaxAttempts ? Math.ceil((windowMs - age) / 60_000) : 0;
  };
  const recordFailure = (key: string) => {
    const f = failures.get(key);
    const t = now().getTime();
    const windowMs = config.pinLockoutMinutes * 60_000;
    if (!f || t - f.firstAt >= windowMs) failures.set(key, { count: 1, firstAt: t });
    else f.count += 1;
  };

  const profile = (officer: Officer) => ({
    id: officer.id,
    staffId: officer.staffId,
    fullName: officer.fullName,
    branchCode: officer.branchCode,
  });

  app.get('/health', async (_req, reply) => {
    try {
      await (repo as { ping?: () => Promise<void> }).ping?.();
      return { status: 'ok' };
    } catch {
      return fail(reply, 503, 'Database unavailable');
    }
  });

  // ---- sign-in ------------------------------------------------------------

  app.post('/v1/auth/login', { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, 'Enter your staff ID, PIN and device id.');
    const { username, pin, deviceId } = parsed.data;
    const key = username.toLowerCase();

    const wait = lockedOut(key);
    if (wait > 0) return fail(reply, 429, `Too many failed attempts. Try again in ${wait} minute(s).`);

    const officer = await repo.findOfficer(username);
    const hash = officer?.passwordHash || DUMMY_HASH;
    const ok = await bcrypt.compare(pin, hash);
    if (!officer || !officer.passwordHash || !ok || !officer.active) {
      recordFailure(key);
      return fail(reply, 401, 'Invalid credentials or account disabled.');
    }
    if (!officer.branchCode) return fail(reply, 403, 'This account has no branch. Contact an administrator.');
    failures.delete(key);

    const issued = tokens.issue({ officerId: officer.id, branchCode: officer.branchCode, deviceId });
    return {
      ...issued,
      officer: profile(officer),
      limits: config.limits,
    };
  });

  app.post('/v1/auth/refresh', async (req, reply) => {
    const parsed = refreshBody.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, 'A refresh token is required.');
    const claims = tokens.verify(parsed.data.refreshToken, 'refresh');
    if (!claims) return fail(reply, 401, 'Session expired. Sign in again.');
    const officer = await repo.getOfficer(claims.officerId);
    if (!officer || !officer.active) return fail(reply, 401, 'Account disabled.');
    return {
      ...tokens.issue({ officerId: officer.id, branchCode: officer.branchCode, deviceId: claims.deviceId }),
      officer: profile(officer),
      limits: config.limits,
    };
  });

  // ---- everything below needs a signed-in, still-active banker -------------

  const requireOfficer = async (req: FastifyRequest, reply: FastifyReply) => {
    const header = String(req.headers.authorization ?? '');
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const claims = token ? tokens.verify(token, 'access') : null;
    if (!claims) return fail(reply, 401, 'Sign in again.');
    // Read the banker fresh every time, so disabling them in the core system cuts access at once.
    const officer = await repo.getOfficer(claims.officerId);
    if (!officer || !officer.active || officer.branchCode !== claims.branchCode) {
      return fail(reply, 401, 'Account disabled or changed. Sign in again.');
    }
    req.officer = officer;
    req.deviceId = claims.deviceId;
  };

  app.get('/v1/me', { preHandler: requireOfficer }, async (req) => {
    const officer = req.officer!;
    const pending = await repo.pendingTotals(officer.id);
    return { officer: profile(officer), limits: config.limits, pendingApproval: pending };
  });

  app.get('/v1/members', { preHandler: requireOfficer }, async (req, reply) => {
    const parsed = membersQuery.safeParse(req.query);
    if (!parsed.success) return fail(reply, 400, 'Invalid paging parameters.');
    const { cursor, limit } = parsed.data;
    const rows = await repo.listMembers(req.officer!.branchCode, cursor ? Number(cursor) : 0, limit);
    return {
      items: rows.map((m) => ({
        code: m.code,
        fullName: m.fullName,
        phone: m.phone,
        status: mapMemberStatus(m.statusCode, m.isActive),
        savingsAccountId: m.savingsAccountId,
        savingsBalance: m.savingsBalance,
      })),
      nextCursor: rows.length === limit ? rows[rows.length - 1].code : null,
    };
  });

  app.post('/v1/deposits', { preHandler: requireOfficer }, async (req, reply) => {
    const officer = req.officer!;
    const parsed = depositBody.safeParse(req.body);
    if (!parsed.success) {
      return fail(reply, 400, parsed.error.issues[0]?.message ?? 'Invalid deposit.');
    }
    const body = parsed.data;
    const reject = (reason: string) => reply.code(422).send({ status: 'REJECTED', localTransactionId: body.localTransactionId, reason });

    const minor = toMinor(body.amount);
    if (minor <= 0n) return reject('The amount must be greater than zero.');
    if (minor > toMinor(config.limits.maxSingleAmount)) {
      return reject(`A single collection cannot exceed GHS ${config.limits.maxSingleAmount}.`);
    }

    const collectedAt = new Date(body.collectedAt);
    const t = now().getTime();
    if (collectedAt.getTime() > t + 24 * 3_600_000) return reject('The collection time is in the future. Check the phone clock.');
    if (collectedAt.getTime() < t - config.maxBackdateDays * 86_400_000) {
      return reject(`This collection is more than ${config.maxBackdateDays} days old. Take it to the office.`);
    }

    const account = await repo.getAccount(body.accountId);
    if (!account || account.customerCode !== body.memberCode) return reject('That savings account does not belong to this member.');
    if (account.branchCode !== officer.branchCode) return reject('This member is not in your branch.');
    if (account.accountStatus.toUpperCase() !== 'ACTIVE') return reject('The savings account is not active.');
    if (mapMemberStatus(account.customerStatusCode, account.customerActive) !== 'ACTIVE') {
      return reject('This member is not active.');
    }

    const outcome = await repo.insertDeposit({
      officer,
      reference: body.localTransactionId,
      customerCode: body.memberCode,
      savingsAccountId: body.accountId,
      amount: body.amount,
      collectedAt,
      branchCode: account.branchCode,
    });

    if (outcome.kind === 'CREATED') {
      return reply.code(201).send({ status: 'ACCEPTED', localTransactionId: body.localTransactionId, serverId: String(outcome.id) });
    }
    const same =
      outcome.customerCode === body.memberCode &&
      outcome.savingsAccountId === body.accountId &&
      toMinor(outcome.amount) === minor;
    if (same) {
      return reply.code(200).send({ status: 'DUPLICATE', localTransactionId: body.localTransactionId, serverId: String(outcome.id) });
    }
    return reply.code(409).send({
      status: 'CONFLICT',
      localTransactionId: body.localTransactionId,
      reason: 'This transaction id was already used for a different deposit.',
    });
  });

  app.get('/v1/deposits', { preHandler: requireOfficer }, async (req, reply) => {
    const parsed = depositsQuery.safeParse(req.query);
    if (!parsed.success) return fail(reply, 400, 'Invalid parameters.');
    const rows = await repo.listDeposits(req.officer!.id, parsed.data.since ? new Date(parsed.data.since) : null, parsed.data.limit);
    return {
      items: rows.map((r) => ({
        serverId: String(r.id),
        localTransactionId: r.reference,
        memberCode: r.customerCode,
        amount: r.amount,
        status: r.status,
        createdAt: r.createdAt,
        decidedAt: r.decidedAt,
        reason: r.reason,
      })),
    };
  });

  app.setErrorHandler((error, _req, reply) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) {
      // Never leak SQL text or stack traces to a phone.
      console.error('server error:', error);
      return reply.code(500).send({ message: 'Something went wrong. Try again.' });
    }
    return reply.code(status).send({ message: (error as Error).message });
  });

  return app;
}
