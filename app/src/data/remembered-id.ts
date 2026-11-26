import * as SecureStore from 'expo-secure-store';

/** The staff ID last signed in with, so it is already there next time. Only the ID: the PIN is never kept. */
const KEY = 'login.staffId';

export async function loadStaffId(): Promise<string> {
  try {
    return (await SecureStore.getItemAsync(KEY)) ?? '';
  } catch {
    return '';
  }
}

/** Remembers the ID, or forgets it when given an empty one. */
export async function saveStaffId(staffId: string): Promise<void> {
  try {
    if (staffId.trim() === '') await SecureStore.deleteItemAsync(KEY);
    else await SecureStore.setItemAsync(KEY, staffId.trim());
  } catch {
    // Not remembered; nothing else is affected.
  }
}
