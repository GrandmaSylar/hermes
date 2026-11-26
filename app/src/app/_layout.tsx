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
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text, fontWeight: '700' },
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.bg },
        animation: 'slide_from_right',
        animationDuration: 280,
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false, animation: 'fade' }} />
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="member/[code]" options={{ title: 'Member' }} />
        <Stack.Screen name="collect/[code]" options={{ title: '', animation: 'fade_from_bottom' }} />
        <Stack.Screen name="register" options={{ title: 'Register member', animation: 'fade_from_bottom' }} />
        <Stack.Screen name="history" options={{ title: 'Activity history', headerBackButtonDisplayMode: 'minimal' }} />
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
