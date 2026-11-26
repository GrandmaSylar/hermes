import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Config } from './config';
import { fromMinor, isAmountText, toMinor } from './money';
import { MAX_LOCAL_ID, storedReference } from './reference';
import type { AccountInfo, DepositKind, Officer, Repo } from './repo';
import {
  memberTypeIsIndividual,
  memberTypeRequiresGuardian,
  memberTypeSharesOptional,
  normaliseIdNumber,
  registrationBody,
  registrationProblems,
  ID_TYPES,
} from './registration';
import { checkDocument, documentBody, MAX_DOCUMENT_BASE64 } from './documents';
import { DocumentError } from './mssql-documents';
import type { PendingSmsNotifier } from './sms';
import { Tokens } from './tokens';

export interface AppDeps {
  config: Config;
  repo: Repo;
  now?: () => Date;
  /** Sends the "received, pending approval" text after a deposit is stored. Omit for none. */
  notifier?: PendingSmsNotifier;
}

/** Savings rows keep their plain id; share rows are marked so the two id spaces never clash. */
export function serverIdOf(kind: DepositKind, id: number): string {
  return kind === 'SHARES' ? `SH${id}` : String(id);
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
  localTransactionId: z
    .string()
    .regex(new RegExp(`^[A-Za-z0-9_-]{8,${MAX_LOCAL_ID}}$`), `localTransactionId must be 8 to ${MAX_LOCAL_ID} letters, digits, - or _`),
  kind: z.enum(['SAVINGS', 'SHARES']).default('SAVINGS'),
  memberCode: z.string().regex(/^\d{1,10}$/),
  accountId: z.number().int().positive(),
  amount: z.string().refine(isAmountText, 'amount must have at most two decimals'),
  collectedAt: z.string().datetime({ offset: true }),
  paymentMode: z.string().trim().min(1).max(40).default('CASH'),
});

const NOUN: Record<DepositKind, string> = { SAVINGS: 'savings account', SHARES: 'share account' };

/** Why a deposit cannot go into this account, in plain English, or null when it can. */
function ineligible(kind: DepositKind, account: AccountInfo, minor: bigint, memberCode: string, branchCode: string): string | null {
  const noun = NOUN[kind];
  if (account.customerCode !== memberCode) return `That ${noun} does not belong to this member.`;
  // A member with no branch recorded (registered in the office app) belongs to every branch.
  if (account.branchCode !== '' && account.branchCode !== branchCode) return 'This member is not in your branch.';
  if (account.accountStatus.toUpperCase() !== 'ACTIVE') return `The ${noun} is not active.`;
  if (account.isClosed) return `The ${noun} is closed.`;
  if (kind === 'SAVINGS' && account.isDormant) return 'The savings account is dormant. Take it to the office.';
  if (account.productActive === false) return `The ${noun}'s product is no longer offered.`;
  if (mapMemberStatus(account.customerStatusCode, account.customerActive) !== 'ACTIVE') return 'This member is not active.';
  const word = kind === 'SAVINGS' ? 'deposit' : 'purchase';
  const min = account.minAmount && toMinor(account.minAmount) > 0n ? toMinor(account.minAmount) : null;
  const max = account.maxAmount && toMinor(account.maxAmount) > 0n ? toMinor(account.maxAmount) : null;
  if (min !== null && minor < min) return `The minimum ${word} for this ${noun} is GHS ${account.minAmount}.`;
  if (max !== null && minor > max) return `The maximum ${word} for this ${noun} is GHS ${account.maxAmount}.`;
  return null;
}

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

  /** Registration is on once every table it writes to is visible to the server's database login. */
  const registrationOn = () => repo.describeSchema?.().registrationEnabled === true;
  /** KYC files can be saved once the member media table is visible too. */
  const documentsOn = () => registrationOn() && repo.describeSchema?.().documentsEnabled === true;
  /** Favourites can be kept on the server once their table exists and is visible. */
  const favoritesOn = () => repo.describeSchema?.().favoritesEnabled === true;

  app.get('/health', async (_req, reply) => {
    try {
      await (repo as { ping?: () => Promise<void> }).ping?.();
      const schema = repo.describeSchema?.();
      return schema ? { status: 'ok', schema } : { status: 'ok' };
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
    const branch = await repo.getBranchInfo(officer.branchCode);
    return {
      officer: profile(officer),
      branch,
      limits: config.limits,
      pendingApproval: pending,
      capabilities: { registration: registrationOn(), documents: documentsOn(), favorites: favoritesOn() },
    };
  });

  // The credit union's logo, for the receipt. The phone says which version it already has, so it is only sent when it changed.
  app.get('/v1/credit-union/logo', { preHandler: requireOfficer }, async (req) => {
    const have = typeof (req.query as { have?: unknown }).have === 'string' ? (req.query as { have: string }).have : '';
    const logo = await repo.getLogo(req.officer!.branchCode);
    if (!logo) return { version: null, dataUri: null };
    return have === logo.version ? { version: logo.version, dataUri: null, unchanged: true } : logo;
  });

  // A member's passport photograph, for their profile. The phone says which version it already has.
  app.get('/v1/members/:code/photo', { preHandler: requireOfficer }, async (req, reply) => {
    const code = String((req.params as { code?: string }).code ?? '');
    if (!/^\d{1,10}$/.test(code)) return fail(reply, 400, 'Invalid member number.');
    const have = typeof (req.query as { have?: unknown }).have === 'string' ? (req.query as { have: string }).have : '';
    const photo = await repo.getMemberPhoto(req.officer!, code);
    if (!photo) return { version: null, mimeType: null, dataBase64: null };
    return have === photo.version ? { version: photo.version, mimeType: photo.mimeType, dataBase64: null, unchanged: true } : photo;
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
        accounts: m.accounts,
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

    // Mobile money would be posted as banker cash by the core's approval, so it is refused outright.
    if (body.paymentMode.toUpperCase() !== 'CASH') return reject('Mobile money deposits are not available yet.');

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

    const kind = body.kind;
    if (kind === 'SHARES' && repo.describeSchema && !repo.describeSchema().sharesEnabled) {
      return reject('Share deposits are not available on this system.');
    }
    const account = await repo.getAccount(kind, body.accountId);
    if (!account) return reject(`That ${NOUN[kind]} does not belong to this member.`);
    const why = ineligible(kind, account, minor, body.memberCode, officer.branchCode);
    if (why) return reject(why);

    const outcome = await repo.insertDeposit({
      officer,
      kind,
      reference: body.localTransactionId,
      customerCode: body.memberCode,
      accountId: body.accountId,
      amount: body.amount,
      collectedAt,
      branchCode: account.branchCode,
      productCode: account.productCode ?? (kind === 'SAVINGS' ? 'MS' : ''),
    });

    if (outcome.kind === 'CREATED') {
      reply.code(201).send({
        status: 'ACCEPTED',
        localTransactionId: body.localTransactionId,
        serverId: serverIdOf(kind, outcome.id),
      });
      // After the row is committed and the answer is on its way: a text can never fail or delay a deposit.
      deps.notifier?.schedule({
        localTransactionId: body.localTransactionId,
        storedReference: storedReference(body.localTransactionId),
        customerCode: body.memberCode,
        branchCode: account.branchCode,
        officerId: officer.id,
        amount: fromMinor(minor),
        productName: account.productName ?? (kind === 'SAVINGS' ? 'savings' : 'shares'),
      });
      return reply;
    }
    const same =
      outcome.depositKind === kind &&
      outcome.customerCode === body.memberCode &&
      outcome.accountId === body.accountId &&
      toMinor(outcome.amount) === minor;
    if (same) {
      return reply
        .code(200)
        .send({ status: 'DUPLICATE', localTransactionId: body.localTransactionId, serverId: serverIdOf(outcome.depositKind, outcome.id) });
    }
    return reply.code(409).send({
      status: 'CONFLICT',
      localTransactionId: body.localTransactionId,
      reason: 'This transaction id was already used for a different deposit.',
    });
  });

  // ---- member registration -------------------------------------------------

  app.get('/v1/member-types', { preHandler: requireOfficer }, async () => {
    const types = await repo.listMemberTypes();
    return {
      items: types
        .filter((t) => memberTypeIsIndividual(t.code))
        .map((t) => ({
          code: t.code,
          label: t.description || t.code,
          sharesOptional: memberTypeSharesOptional(t.code),
          guardianRequired: memberTypeRequiresGuardian(t.code),
        })),
    };
  });

  const checkBody = z.object({
    nationalId: z.string().trim().max(30).optional().default(''),
    voterIdNo: z.string().trim().max(30).optional().default(''),
    nhisNo: z.string().trim().max(30).optional().default(''),
    passportNo: z.string().trim().max(30).optional().default(''),
    phone: z.string().trim().max(50).optional().default(''),
    email: z.string().trim().max(150).optional().default(''),
  });

  /** Who already holds these IDs, phone numbers or email addresses (the form's live "already registered" check). */
  app.post('/v1/members/check', { preHandler: requireOfficer }, async (req, reply) => {
    const parsed = checkBody.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, 'Invalid request.');
    const b = parsed.data;
    const conflicts = await repo.findMemberConflicts({
      ids: {
        nationalId: normaliseIdNumber('GHANA_CARD', b.nationalId),
        voterIdNo: normaliseIdNumber('VOTER_ID', b.voterIdNo),
        nhisNo: normaliseIdNumber('NHIS', b.nhisNo),
        passportNo: normaliseIdNumber('PASSPORT', b.passportNo),
      },
      phone: b.phone,
      email: b.email,
    });
    return { conflicts };
  });

  app.post('/v1/registrations', { preHandler: requireOfficer }, async (req, reply) => {
    const officer = req.officer!;
    if (!registrationOn()) return fail(reply, 503, 'Registering members from the field is not switched on yet.');
    const parsed = registrationBody.safeParse(req.body);
    if (!parsed.success) {
      return fail(reply, 400, parsed.error.issues[0]?.message ?? 'Invalid registration.');
    }
    const body = parsed.data;
    // Same text the registration form shows: ID numbers are tidied before they are checked or stored.
    for (const type of ID_TYPES) body[type.field] = normaliseIdNumber(type.key, body[type.field]);
    const reject = (reason: string) => reply.code(422).send({ status: 'REJECTED', localRegistrationId: body.localRegistrationId, reason });

    const problems = registrationProblems(body, now());
    if (problems.length > 0) return reject(problems.join('. ') + '.');

    const types = await repo.listMemberTypes();
    if (!types.some((t) => t.code === body.memberType)) return reject('That member type is not available.');

    // A retry of a registration that already went through returns the same member.
    const earlier = await repo.findEarlierRegistration(officer, body);
    if (earlier) {
      return reply.code(200).send({ status: 'DUPLICATE', localRegistrationId: body.localRegistrationId, serverId: earlier });
    }

    const conflicts = await repo.findMemberConflicts({
      ids: { nationalId: body.nationalId, voterIdNo: body.voterIdNo, nhisNo: body.nhisNo, passportNo: body.passportNo },
      phone: body.phone,
      email: body.email,
    });
    if (conflicts.length > 0) {
      const c = conflicts[0];
      const who = c.memberName || `Member ${c.memberCode}`;
      const isId = c.label !== 'Phone' && c.label !== 'Email';
      return reject(
        isId
          ? `${c.label} ${c.value} already belongs to ${who} (member ${c.memberCode}).`
          : `${c.label} ${c.value} already in use by ${who} (Code ${c.memberCode}).`,
      );
    }

    const created = await repo.registerMember(officer, body);
    return reply.code(201).send({ status: 'ACCEPTED', localRegistrationId: body.localRegistrationId, serverId: created.memberCode });
  });

  /** One KYC file for a member this banker registered and the office has not approved yet. Sending the same kind again replaces it. */
  app.post(
    '/v1/members/:code/documents',
    { preHandler: requireOfficer, bodyLimit: MAX_DOCUMENT_BASE64 + 4096 },
    async (req, reply) => {
      if (!documentsOn()) return fail(reply, 503, 'Uploading KYC documents is not switched on yet.');
      const code = String((req.params as { code?: string }).code ?? '');
      if (!/^\d{1,10}$/.test(code)) return fail(reply, 400, 'Invalid member number.');
      const parsed = documentBody.safeParse(req.body);
      if (!parsed.success) return fail(reply, 400, parsed.error.issues[0]?.message ?? 'Invalid document.');
      const checked = checkDocument(parsed.data);
      if ('problem' in checked) return reply.code(422).send({ status: 'REJECTED', kind: parsed.data.kind, reason: checked.problem });
      try {
        await repo.saveMemberDocument(req.officer!, code, checked);
      } catch (error) {
        if (error instanceof DocumentError) {
          return reply.code(error.status).send({ status: error.status === 409 ? 'CONFLICT' : 'REJECTED', kind: checked.kind, reason: error.message });
        }
        throw error;
      }
      return { status: 'SAVED', kind: checked.kind };
    },
  );

  // ---- the account follows the person, not the phone -----------------------------------------------------------

  /** Favourite members, so a phone signing in again (or another phone) gets the same list. */
  app.get('/v1/favorites', { preHandler: requireOfficer }, async (req, reply) => {
    if (!favoritesOn()) return fail(reply, 503, 'Favourites are not switched on yet.');
    return { codes: await repo.listFavorites(req.officer!.id) };
  });

  for (const [method, on] of [['PUT', true], ['DELETE', false]] as const) {
    app.route({
      method,
      url: '/v1/favorites/:code',
      preHandler: requireOfficer,
      handler: async (req, reply) => {
        if (!favoritesOn()) return fail(reply, 503, 'Favourites are not switched on yet.');
        const code = String((req.params as { code?: string }).code ?? '');
        if (!/^\d{1,10}$/.test(code)) return fail(reply, 400, 'Invalid member number.');
        await repo.setFavorite(req.officer!.id, code, on);
        return { code, favorite: on };
      },
    });
  }

  /** The members this officer registered, with where each stands (PND until the office approves). */
  app.get('/v1/registrations', { preHandler: requireOfficer }, async (req, reply) => {
    const parsed = depositsQuery.safeParse(req.query);
    if (!parsed.success) return fail(reply, 400, 'Invalid parameters.');
    const rows = await repo.listRegisteredMembers(req.officer!, parsed.data.since ? new Date(parsed.data.since) : null, parsed.data.limit);
    return {
      items: rows.map((r) => ({
        memberCode: r.code,
        firstName: r.firstName,
        lastName: r.lastName,
        phone: r.phone,
        sex: r.sex,
        birthDate: r.birthDate,
        status: r.statusCode,
        createdAt: r.createdAt,
      })),
    };
  });

  app.get('/v1/deposits', { preHandler: requireOfficer }, async (req, reply) => {
    const parsed = depositsQuery.safeParse(req.query);
    if (!parsed.success) return fail(reply, 400, 'Invalid parameters.');
    const rows = await repo.listDeposits(req.officer!.id, parsed.data.since ? new Date(parsed.data.since) : null, parsed.data.limit);
    return {
      items: rows.map((r) => ({
        serverId: serverIdOf(r.kind, r.id),
        kind: r.kind,
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
