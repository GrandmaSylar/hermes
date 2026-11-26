import * as SecureStore from 'expo-secure-store';

/**
 * Whether the opening animation has been shown on this device. It is kept in the device keystore, not in an
 * officer's database, because it belongs to the phone: the first launch on a new device, whoever signs in.
 */
const KEY = 'qss.introSeen';

export async function loadIntroSeen(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(KEY)) === '1';
  } catch {
    // If the keystore cannot be read, do not trap the person behind an animation.
    return true;
  }
}

export async function saveIntroSeen(): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, '1');
  } catch {
    // Shown again next time; harmless.
  }
}
