import { Redirect } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { useApp } from '@/state/AppProvider';
import { colors } from '@/ui/theme';

/** Entry point: sends the user to the right place for the app's current state. */
export default function Index() {
  const { status, error } = useApp();

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (status === 'error') {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
        <Text style={{ fontSize: 18, fontWeight: '600', color: colors.danger, marginBottom: 8 }}>App cannot start</Text>
        <Text style={{ color: colors.text }}>{error}</Text>
      </View>
    );
  }
  if (status === 'ready') return <Redirect href="/(tabs)" />;
  return <Redirect href="/login" />;
}
