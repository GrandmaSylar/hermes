import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import type * as SQLite from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { ApiClient } from '@/data/api/contract';
import { MockApi } from '@/data/api/mock';
import { openDatabase, wipeLocalData } from '@/data/db/database';
import { createSqliteRepos } from '@/data/db/sqlite-repos';
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
  syncNow: () => Promise<SyncReport | null>;
  signInPassword: (staffId: string, password: string) => Promise<string>;
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

  const dbRef = useRef<SQLite.SQLiteDatabase | null>(null);
  const offlineRef = useRef(false);
  offlineRef.current = simulateOffline;

  // One mock API for the life of the app. The simulated-offline switch is read at call time.
  const api = useMemo<ApiClient>(() => new MockApi({ failNetwork: () => __DEV__ && offlineRef.current }), []);

  const touch = useCallback(() => setVersion((v) => v + 1), []);

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

  const syncNow = useCallback(async (): Promise<SyncReport | null> => {
    if (!repos || !session) return null;
    setSyncing(true);
    try {
      const report = await syncOnce({ repos, api, session });
      setLastReport(report);
      if (!report.offline) setLastSyncAt(new Date().toISOString());
      if (report.authError) setStatus('signedOut');
      touch();
      return report;
    } finally {
      setSyncing(false);
    }
  }, [repos, api, session, touch]);

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
    async (staffId: string, password: string) => (await api.login(staffId, password)).challengeId,
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
        if (unsynced.count > 0) return false;
      }
      await clearSession();
      if (dbRef.current) await wipeLocalData(dbRef.current);
      setSession(null);
      setStatus('signedOut');
      touch();
      return true;
    },
    [repos, touch],
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
    signInOtp,
    unlock,
    signOut,
    newId: () => Crypto.randomUUID(),
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
