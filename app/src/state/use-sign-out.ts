import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useApp } from '@/state/AppProvider';

/**
 * Signing out. The officer's favourites, history and anything not yet sent stay on the phone, in their own
 * encrypted database, and are there again (and sent) when they sign back in.
 */
export function useSignOut(): () => void {
  const { signOut } = useApp();
  return useCallback(() => {
    // A short wait lets any menu that opened this finish closing: iOS drops an alert shown over a closing modal.
    setTimeout(() => {
      Alert.alert('Sign out?', 'Your favourites and history stay on this phone for next time.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
      ]);
    }, 300);
  }, [signOut]);
}

/**
 * Removing the officer's data from this phone, for a phone that is being handed on. Refused while anything is
 * still waiting to be sent, because that exists nowhere else yet.
 */
export function useForgetAccount(): () => void {
  const { signOut, repos, syncNow } = useApp();
  return useCallback(() => {
    Alert.alert('Remove my data from this phone?', 'Favourites and history come back from the office when you sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const waiting = repos ? (await repos.outbox.unsyncedTotals()).count + (await repos.registrations.waitingCount()) : 0;
            if (waiting > 0) {
              Alert.alert('Items are waiting to sync', 'Send them first, so nothing is lost.', [
                { text: 'Not now', style: 'cancel' },
                { text: 'Sync now', onPress: () => void syncNow() },
              ]);
              return;
            }
            await signOut({ forget: true });
          })();
        },
      },
    ]);
  }, [signOut, repos, syncNow]);
}
