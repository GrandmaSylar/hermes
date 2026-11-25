import { Tabs } from 'expo-router';
import { useApp } from '@/state/AppProvider';
import { colors } from '@/ui/theme';

export default function TabsLayout() {
  const { status } = useApp();
  // The root layout only mounts these screens once signed in; this is just a safety net.
  if (status !== 'ready') return null;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.text,
        tabBarLabelStyle: { fontSize: 13, fontWeight: '600' },
        // Labels only: no icon library, to keep the app light on entry-level phones.
        tabBarIcon: () => null,
        tabBarIconStyle: { display: 'none' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Members', tabBarLabel: 'Members' }} />
      <Tabs.Screen name="sync" options={{ title: 'Sync', tabBarLabel: 'Sync' }} />
    </Tabs>
  );
}
