import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import type * as SQLite from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { ApiCapabilities, ApiClient, MemberConflict, MemberLookup } from '@/data/api/contract';
import { HttpApi } from '@/data/api/http';
import type { PhotoAnswer } from '@/data/photos';
import { MockApi } from '@/data/api/mock';
import { API_MODE, API_URL } from '@/config';
import { openDatabase, wipeLocalData } from '@/data/db/database';
import { createSqliteRepos } from '@/data/db/sqlite-repos';
import { createFileStore, type FileStore } from '@/data/files';
import type { Repos } from '@/data/repositories';
import type { Session } from '@/domain/types';
import { syncOnce, type SyncReport } from '@/sync/engine';
import { clearSession, getDeviceId, loadSession, saveSession, unlockWithDevice } from './session-store';

export type AppStatus = 'loading' | 'signedOut' | 'locked' | 'ready' | 'error';

interface AppContextValue {
  status: AppStatus;
  error: string | null;
  session: Session | null;
  repos: Repos | null;
  /** Bumps after every sync or capture so screens re-query local data. */
  version: number;
  touch: () => void;
  syncing: boolean;
  lastReport: SyncReport | null;
  lastSyncAt: string | null;
  /** Development only: pretend the network is down. */
  simulateOffline: boolean;
  setSimulateOffline: (value: boolean) => void;
  /** Sends waiting items and fetches new members. `full` re-downloads every member and balance. */
  syncNow: (options?: { full?: boolean }) => Promise<SyncReport | null>;
  /** The server's answer to a password: null when signed in, or the id of an SMS code challenge. */
  signInPassword: (staffId: string, password: string) => Promise<string | null>;
  capabilities: ApiCapabilities;
  /** Who already holds these IDs, phone numbers or emails. Null when there is no connection to ask. */
  checkMember: (lookup: MemberLookup) => Promise<MemberConflict[] | null>;
  /** A member's passport photo from the office, or null when offline or there is none. */
  memberPhoto: (memberCode: string, have: string | null) => Promise<PhotoAnswer>;
  /** Where KYC pictures are kept on the phone until they are sent. */
  files: FileStore;
  /** 'mock' means demo data: the app is not connected to the core system. */
  apiMode: 'http' | 'mock';
  signInOtp: (challengeId: string, otp: string) => Promise<void>;
  unlock: () => Promise<boolean>;
  /** Returns false (and does nothing) while items are waiting to sync, unless forced. */
  signOut: (force?: boolean) => Promise<boolean>;
  newId: () => string;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppProvider');
  return value;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AppStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [repos, setRepos] = useState<Repos | null>(null);
  const [version, setVersion] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastReport, setLastReport] = useState<SyncReport | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [simulateOffline, setSimulateOffline] = useState(false);

  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;
  const dbRef = useRef<SQLite.SQLiteDatabase | null>(null);
  const offlineRef = useRef(false);
  offlineRef.current = simulateOffline;

  // One mock API for the life of the app. The simulated-offline switch is read at call time.
  const api = useMemo<ApiClient>(() => {
    if (API_MODE === 'mock') return new MockApi({ failNetwork: () => __DEV__ && offlineRef.current });
    return new HttpApi({
      baseUrl: API_URL,
      // When the server renews the session, keep the new tokens so the next launch can still sync.
      onTokens: (tokens) => {
        const current = sessionRef.current;
        if (!current) return;
        const next = { ...current, ...tokens };
        sessionRef.current = next;
        setSession(next);
        void saveSession(next);
      },
    });
  }, []);

  const touch = useCallback(() => setVersion((v) => v + 1), []);
  // Where KYC pictures are kept on the phone until they are sent.
  const files = useMemo(() => createFileStore(), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await openDatabase();
        if (cancelled) return;
        dbRef.current = db;
        setRepos(createSqliteRepos(db));
        const stored = await loadSession();
        if (stored) {
          setSession(stored);
          setStatus('locked');
        } else {
          setStatus('signedOut');
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'The app could not start.');
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const syncNow = useCallback(async (options?: { full?: boolean }): Promise<SyncReport | null> => {
    if (!repos || !session) return null;
    setSyncing(true);
    try {
      const report = await syncOnce({ repos, api, session, fullRefresh: options?.full, files });
      setLastReport(report);
      if (!report.offline) setLastSyncAt(new Date().toISOString());
      if (report.authError) setStatus('signedOut');
      touch();
      return report;
    } finally {
      setSyncing(false);
    }
  }, [repos, api, session, touch, files]);

  // Automatic sync: when the app becomes ready, returns to the foreground, or the network returns.
  const syncRef = useRef(syncNow);
  syncRef.current = syncNow;
  useEffect(() => {
    if (status !== 'ready') return;
    void syncRef.current();
    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncRef.current();
    });
    let wasOnline = true;
    const netUnsub = NetInfo.addEventListener((state) => {
      const online = state.isConnected === true && state.isInternetReachable !== false;
      if (online && !wasOnline) void syncRef.current();
      wasOnline = online;
    });
    return () => {
      appSub.remove();
      netUnsub();
    };
  }, [status]);

  const signInPassword = useCallback(
    async (staffId: string, password: string): Promise<string | null> => {
      const result = await api.login(staffId, password, await getDeviceId());
      if (result.kind === 'OTP_REQUIRED') return result.challengeId;
      await saveSession(result.session);
      setSession(result.session);
      setStatus('ready');
      return null;
    },
    [api],
  );

  const signInOtp = useCallback(
    async (challengeId: string, otp: string) => {
      const deviceId = await getDeviceId();
      const next = await api.verifyOtp(challengeId, otp, deviceId);
      await saveSession(next);
      setSession(next);
      setStatus('ready');
    },
    [api],
  );

  const checkMember = useCallback(
    async (lookup: MemberLookup): Promise<MemberConflict[] | null> => {
      if (!session || offlineRef.current) return null;
      try {
        return await api.checkMember(session, lookup);
      } catch {
        return null;
      }
    },
    [api, session],
  );

  const memberPhoto = useCallback(
    async (memberCode: string, have: string | null): Promise<PhotoAnswer> => {
      if (!session || offlineRef.current || !api.fetchMemberPhoto) return null;
      return api.fetchMemberPhoto(session, memberCode, have);
    },
    [api, session],
  );

  const unlock = useCallback(async () => {
    const ok = await unlockWithDevice();
    if (ok) setStatus('ready');
    return ok;
  }, []);

  const signOut = useCallback(
    async (force = false): Promise<boolean> => {
      // Signing out wipes the on-device data. Refuse while collections are
      // still waiting to sync, so cash entries are never lost by accident.
      if (!force && repos) {
        const unsynced = await repos.outbox.unsyncedTotals();
        if (unsynced.count > 0 || (await repos.registrations.waitingCount()) > 0) return false;
      }
      await clearSession();
      api.reset?.();
      if (dbRef.current) await wipeLocalData(dbRef.current);
      setSession(null);
      setStatus('signedOut');
      touch();
      return true;
    },
    [repos, touch, api],
  );

  const value: AppContextValue = {
    status,
    error,
    session,
    repos,
    version,
    touch,
    syncing,
    lastReport,
    lastSyncAt,
    simulateOffline,
    setSimulateOffline,
    syncNow,
    signInPassword,
    capabilities: api.capabilities,
    checkMember,
    memberPhoto,
    files,
    apiMode: API_MODE,
    signInOtp,
    unlock,
    signOut,
    newId: () => Crypto.randomUUID(),
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
