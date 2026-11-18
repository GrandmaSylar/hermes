import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import type { Session } from '@/domain/types';

const SESSION_KEY = 'qss.session';
const DEVICE_KEY = 'qss.deviceId';
const OPTIONS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

/** A stable id for this installation. The core system registers and tracks it. */
export async function getDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_KEY);
  if (existing) return existing;
  const id = Crypto.randomUUID();
  await SecureStore.setItemAsync(DEVICE_KEY, id, OPTIONS);
  return id;
}

export async function saveSession(session: Session): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), OPTIONS);
}

export async function loadSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}

/**
 * Local unlock with the phone's biometric or screen lock.
 *
 * This is the offline stand-in for passkey sign-in: a passkey needs the server
 * to verify it, so the app unlocks locally and the passkey step completes at
 * the next sync (spec FR-1b). Real passkey registration is a later slice and
 * needs the core system's WebAuthn endpoints.
 */
export async function unlockWithDevice(): Promise<boolean> {
  const hardware = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  // A phone with no lock at all cannot protect the data, so refuse rather than skip.
  if (!hardware && !enrolled) return false;
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Unlock QSS Mobile Banking',
    // Allow the phone's PIN/pattern when there is no fingerprint sensor (many entry-level phones).
    disableDeviceFallback: false,
  });
  return result.success;
}
