export interface Config {
  port: number;
  host: string;
  jwtSecret: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  db: {
    server: string;
    port: number;
    database: string;
    user: string;
    password: string;
    encrypt: boolean;
    trustServerCertificate: boolean;
  };
  limits: {
    maxSingleAmount: string;
    maxUnsyncedAmount: string;
    maxUnsyncedItems: number;
  };
  /** How many days back a collection may be dated, and how far ahead (clock drift). */
  maxBackdateDays: number;
  pinMaxAttempts: number;
  pinLockoutMinutes: number;
}

function need(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key]?.trim();
  if (!v) throw new Error(`Missing setting ${key}`);
  return v;
}

function flag(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback;
  return v.toLowerCase() === 'true';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const jwtSecret = need(env, 'JWT_SECRET');
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    jwtSecret,
    accessTtlSeconds: Number(env.ACCESS_TTL_SECONDS ?? 30 * 60),
    refreshTtlSeconds: Number(env.REFRESH_TTL_SECONDS ?? 12 * 60 * 60),
    db: {
      server: need(env, 'DB_SERVER'),
      port: Number(env.DB_PORT ?? 1433),
      database: need(env, 'DB_NAME'),
      user: need(env, 'DB_USER'),
      password: need(env, 'DB_PASSWORD'),
      encrypt: flag(env.DB_ENCRYPT, true),
      trustServerCertificate: flag(env.DB_TRUST_SERVER_CERTIFICATE, true),
    },
    limits: {
      maxSingleAmount: env.MAX_SINGLE_AMOUNT ?? '5000.00',
      maxUnsyncedAmount: env.MAX_UNSYNCED_AMOUNT ?? '50000.00',
      maxUnsyncedItems: Number(env.MAX_UNSYNCED_ITEMS ?? 200),
    },
    maxBackdateDays: Number(env.MAX_BACKDATE_DAYS ?? 7),
    pinMaxAttempts: Number(env.PIN_MAX_ATTEMPTS ?? 5),
    pinLockoutMinutes: Number(env.PIN_LOCKOUT_MINUTES ?? 15),
  };
}
