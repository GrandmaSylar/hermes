import { Ionicons } from '@expo/vector-icons';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { useApp } from '@/state/AppProvider';
import { CuaEmblem } from '@/ui/brand';
import { FirstLaunchIntro } from '@/ui/intro';
import { BrandLoader, Reveal } from '@/ui/motion';
import { colors } from '@/ui/theme';

/**
 * Shown only while the app starts (or cannot start), and once on a new device for the opening animation. When that
 * is settled the navigator moves on by itself to sign-in or the app.
 */
export default function Index() {
  const { status, error, intro } = useApp();

  // The phone's own splash stays up until we know which opening to show, so there is no flash between them.
  useEffect(() => {
    if (intro.known) void SplashScreen.hideAsync().catch(() => undefined);
  }, [intro.known]);

  if (status === 'error') {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center', gap: 12, backgroundColor: colors.bg }}>
        <Ionicons name="alert-circle" size={44} color={colors.danger} />
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>App cannot start</Text>
        <Text selectable style={{ color: colors.muted, textAlign: 'center' }}>{error}</Text>
      </View>
    );
  }

  if (intro.playing) return <FirstLaunchIntro ready={status !== 'loading'} onDone={intro.finish} />;

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
  return null;
}
