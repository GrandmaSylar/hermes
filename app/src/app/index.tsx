import { Ionicons } from '@expo/vector-icons';
import { Redirect } from 'expo-router';
import { Text, View } from 'react-native';
import { useApp } from '@/state/AppProvider';
import { CuaEmblem } from '@/ui/brand';
import { BrandLoader, Reveal } from '@/ui/motion';
import { colors } from '@/ui/theme';

/** Entry point: sends the user to the right place for the app's current state. */
export default function Index() {
  const { status, error } = useApp();

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20, backgroundColor: colors.bg }}>
        <BrandLoader size={150}>
          {/* The emblem is navy and red, so it always sits on white */}
          <View style={{ width: 104, height: 104, borderRadius: 52, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
            <CuaEmblem size={76} />
          </View>
        </BrandLoader>
        <Reveal style={{ alignItems: 'center', gap: 4 }}>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700', letterSpacing: -0.3 }}>QSS Mobile Banking</Text>
          <Text style={{ color: '#EA3137', fontSize: 13, fontStyle: 'italic', fontWeight: '600' }}>...building a happy family</Text>
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
