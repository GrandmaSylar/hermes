import { Ionicons } from '@expo/vector-icons';
import { Redirect } from 'expo-router';
import { Text, View } from 'react-native';
import { useApp } from '@/state/AppProvider';
import { BrandLoader, Reveal } from '@/ui/motion';
import { colors } from '@/ui/theme';

/** Entry point: sends the user to the right place for the app's current state. */
export default function Index() {
  const { status, error } = useApp();

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20, backgroundColor: colors.bg }}>
        <BrandLoader />
        <Reveal>
          <Text style={{ color: colors.muted, fontSize: 14, fontWeight: '500' }}>Opening QSS Mobile Banking</Text>
        </Reveal>
      </View>
    );
  }
  if (status === 'error') {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center', gap: 12, backgroundColor: colors.bg }}>
        <Ionicons name="alert-circle" size={44} color={colors.danger} />
        <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>App cannot start</Text>
        <Text selectable style={{ color: colors.muted, textAlign: 'center' }}>{error}</Text>
      </View>
    );
  }
  if (status === 'ready') return <Redirect href="/(tabs)" />;
  return <Redirect href="/login" />;
}
