import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useApp } from '@/state/AppProvider';

/**
 * Signing out, with a check first. Signing out wipes the data on this phone, so it is refused while deposits or
 * registrations are still waiting to sync, and the person is offered a sync instead.
 */
export function useSignOut(): () => void {
  const { signOut, syncNow } = useApp();
  return useCallback(() => {
    // A short wait lets any menu that opened this finish closing: iOS drops an alert shown over a closing modal.
    setTimeout(() => {
      Alert.alert('Sign out?', 'You will need your staff ID and PIN to sign in again.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: () => {
            void signOut().then((done) => {
              if (done) return;
              Alert.alert('Items are waiting to sync', 'Sync first, so no deposit is lost.', [
                { text: 'Not now', style: 'cancel' },
                { text: 'Sync now', onPress: () => void syncNow() },
              ]);
            });
          },
        },
      ]);
    }, 300);
  }, [signOut, syncNow]);
}
