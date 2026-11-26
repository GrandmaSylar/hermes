import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { AppProvider, useApp } from '@/state/AppProvider';
import { colors } from '@/ui/theme';

// Keep the phone's own splash screen up until the first screen is ready to take over (see the entry screen).
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

/**
 * Which screens exist is decided here, in one place, by the app's state: the loading screen while it starts
 * (or if it cannot), the sign-in screen when nobody is signed in, and the app once someone is. The guards never
 * overlap, so the navigator itself moves to the one screen that is allowed whenever the state changes, including
 * on sign-out. No screen redirects on its own: that is what used to loop ("Maximum update depth exceeded").
 */
function Screens() {
  const { status, appearance, intro } = useApp();
  // The opening animation is part of starting: it holds the entry screen until it has played.
  const starting = status === 'loading' || status === 'error' || intro.playing;
  const signedOut = status === 'signedOut' || status === 'locked';
  const signedIn = status === 'ready';
  return (
    <>
      <StatusBar style={appearance.scheme === 'dark' ? 'light' : 'dark'} />
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
        <Stack.Protected guard={starting}>
          <Stack.Screen name="index" options={{ headerShown: false, animation: 'fade' }} />
        </Stack.Protected>
        <Stack.Protected guard={signedOut}>
          <Stack.Screen name="login" options={{ headerShown: false, animation: 'fade' }} />
        </Stack.Protected>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false, animation: 'fade' }} />
          <Stack.Screen name="member/[code]" options={{ title: 'Member' }} />
          <Stack.Screen name="collect/[code]" options={{ title: '', animation: 'fade_from_bottom' }} />
          <Stack.Screen name="register" options={{ title: 'Register member', animation: 'fade_from_bottom' }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <AppProvider>
      <Screens />
    </AppProvider>
  );
}
