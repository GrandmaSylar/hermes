import * as SecureStore from 'expo-secure-store';
import { Appearance } from 'react-native';

/** Which look the person chose: follow the phone, or always light, or always dark (AMOLED black). */
export type Preference = 'system' | 'light' | 'dark';

export const PREFERENCES: { value: Preference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const KEY = 'appearance.preference';

export const parsePreference = (value: unknown): Preference => (value === 'light' || value === 'dark' ? value : 'system');

export async function loadPreference(): Promise<Preference> {
  try {
    return parsePreference(await SecureStore.getItemAsync(KEY));
  } catch {
    return 'system';
  }
}

export async function savePreference(preference: Preference): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, preference);
  } catch {
    // The choice still applies for this session.
  }
}

/** Tells the phone too, so its own pieces (date picker, keyboard, alerts) match the app. */
export function applyPreference(preference: Preference): void {
  try {
    Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
  } catch {
    // Not supported: the app's own colours still change.
  }
}
