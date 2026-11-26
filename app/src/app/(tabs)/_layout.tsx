import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { useApp } from '@/state/AppProvider';
import { colors } from '@/ui/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const icon = (focused: IconName, idle: IconName) =>
  function TabIcon({ color, size, focused: on }: { color: ColorValue; size: number; focused: boolean }) {
    return <Ionicons name={on ? focused : idle} size={size + 2} color={color as string} />;
  };

export default function TabsLayout() {
  const { status } = useApp();
  // The root layout only mounts these screens once signed in; this is just a safety net.
  if (status !== 'ready') return null;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '700', color: colors.text },
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', headerShown: false, tabBarIcon: icon('home', 'home-outline') }} />
      <Tabs.Screen name="members" options={{ title: 'Members', headerShown: false, tabBarIcon: icon('people', 'people-outline') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', headerShown: false, tabBarIcon: icon('settings', 'settings-outline') }} />
    </Tabs>
  );
}
