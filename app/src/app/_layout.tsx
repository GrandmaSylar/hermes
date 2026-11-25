import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppProvider, useApp } from '@/state/AppProvider';
import { colors } from '@/ui/theme';

/**
 * Screens are guarded here, in one place, rather than with a Redirect inside each layout: a
 * Redirect in the tabs layout fought with the entry screen's own redirect and looped forever
 * ("Maximum update depth exceeded") while the app was still loading.
 */
function Screens() {
  const { status } = useApp();
  const signedIn = status === 'ready';
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="member/[code]" options={{ title: 'Member' }} />
        <Stack.Screen name="collect/[code]" options={{ title: 'Deposit' }} />
        <Stack.Screen name="register" options={{ title: 'Register member' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AppProvider>
      <StatusBar style="dark" />
      <Screens />
    </AppProvider>
  );
}
