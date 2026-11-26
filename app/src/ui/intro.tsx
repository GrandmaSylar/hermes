import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { brand, brandGradient } from '@/ui/colors';
import { isReduceMotion, tap } from '@/ui/motion';

/**
 * The opening of the app on a new device: shown once, never again. Rings radiate from the credit union's emblem,
 * which settles into place with a red dot orbiting it (the red of the Ghana map); the name arrives letter by
 * letter, then three promises, then the whole screen leans in and dissolves into sign-in. Tapping skips it.
 * It never ends before the app itself is ready, so it costs no extra waiting.
 */

const LENGTH = 4300;
const NAME = ['Q', 'S', 'S'];
const PROMISES: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string }[] = [
  { icon: 'cloud-offline-outline', label: 'Works offline' },
  { icon: 'sync-outline', label: 'Syncs by itself' },
  { icon: 'shield-checkmark-outline', label: 'Secure sign-in' },
];

export function FirstLaunchIntro({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const reduce = isReduceMotion();
  const t = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  const leave = useRef(new Animated.Value(0)).current;
  const rings = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  const [finished, setFinished] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // The whole performance runs on one clock, so every part stays in step.
  useEffect(() => {
    if (reduce) {
      setFinished(true);
      return;
    }
    Animated.timing(t, { toValue: 1, duration: LENGTH, easing: Easing.linear, useNativeDriver: true }).start(() => setFinished(true));
    const loops = rings.map((v, i) => Animated.loop(Animated.sequence([Animated.delay(i * 420), Animated.timing(v, { toValue: 1, duration: 1900, easing: Easing.out(Easing.cubic), useNativeDriver: true }), Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true })]), { iterations: 2 }));
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [t, rings, reduce]);

  const leaveNow = () => {
    if (leaving) return;
    setLeaving(true);
    tap('light');
    Animated.timing(leave, { toValue: 1, duration: 380, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => onDone());
  };

  // Ends by itself once the show is over and the app is ready.
  useEffect(() => {
    if (finished && ready) {
      const timer = setTimeout(leaveNow, reduce ? 700 : 350);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, ready]);

  const seg = (from: number, to: number) => t.interpolate({ inputRange: [from, to], outputRange: [0, 1], extrapolate: 'clamp' });
  const emblemIn = seg(0.05, 0.3);
  const orbit = t.interpolate({ inputRange: [0.1, 0.62], outputRange: ['0deg', '540deg'], extrapolate: 'clamp' });
  const orbitFade = t.interpolate({ inputRange: [0.1, 0.18, 0.55, 0.66], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' });
  const subtitle = seg(0.42, 0.52);
  const tagline = seg(0.5, 0.6);
  const hint = seg(0.82, 0.92);

  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Skip introduction" onPress={leaveNow} style={{ flex: 1 }}>
      <Animated.View
        style={{
          flex: 1,
          backgroundColor: brand.navy,
          experimental_backgroundImage: brandGradient(165),
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          opacity: leave.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          transform: [{ scale: leave.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }],
        }}
      >
        <StatusBar style="light" />

        {/* Rings radiating from the emblem */}
        <View style={{ position: 'absolute', top: '36%', alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
          {rings.map((v, i) => (
            <Animated.View
              key={i}
              style={{ position: 'absolute', width: 160, height: 160, borderRadius: 80, borderWidth: 1.5, borderColor: '#FFFFFF', opacity: v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.4, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 3.2] }) }] }}
            />
          ))}
        </View>

        {/* Emblem with its orbiting red dot */}
        <View style={{ position: 'absolute', top: '36%', marginTop: -84, width: 168, height: 168, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View style={{ position: 'absolute', width: 168, height: 168, opacity: orbitFade, transform: [{ rotate: orbit }] }}>
            <View style={{ alignSelf: 'center', width: 12, height: 12, borderRadius: 6, backgroundColor: brand.red, boxShadow: `0 0 14px ${brand.red}` }} />
          </Animated.View>
          <Animated.View style={{ opacity: emblemIn, transform: [{ scale: emblemIn.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }, { rotate: emblemIn.interpolate({ inputRange: [0, 1], outputRange: ['-14deg', '0deg'] }) }] }}>
            <Image source={require('../../assets/cua-emblem-white.png')} contentFit="contain" accessibilityLabel="Credit union emblem" style={{ width: 120, height: 120 }} />
          </Animated.View>
        </View>

        {/* Name, letter by letter */}
        <View style={{ position: 'absolute', top: '36%', marginTop: 112, alignItems: 'center', gap: 6 }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {NAME.map((ch, i) => {
              const p = seg(0.3 + i * 0.05, 0.4 + i * 0.05);
              return (
                <Animated.Text key={i} style={{ fontSize: 44, fontWeight: '700', color: '#FFFFFF', letterSpacing: 2, opacity: p, transform: [{ translateY: p.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) }, { scale: p.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] }}>
                  {ch}
                </Animated.Text>
              );
            })}
          </View>
          <Animated.Text style={{ fontSize: 17, fontWeight: '500', color: 'rgba(255,255,255,0.9)', letterSpacing: 0.5, opacity: subtitle, transform: [{ translateY: subtitle.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
            Mobile Banking
          </Animated.Text>
          <Animated.Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', opacity: tagline }}>Field banking for credit unions</Animated.Text>
        </View>

        {/* Three promises */}
        <View style={{ position: 'absolute', bottom: insets.bottom + 96, flexDirection: 'row', gap: 10, paddingHorizontal: 16 }}>
          {PROMISES.map((p, i) => {
            const v = seg(0.62 + i * 0.07, 0.74 + i * 0.07);
            return (
              <Animated.View key={p.label} style={{ flex: 1, alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>
                <Ionicons name={p.icon} size={22} color="#FFFFFF" />
                <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', fontWeight: '500', textAlign: 'center' }}>{p.label}</Text>
              </Animated.View>
            );
          })}
        </View>

        <Animated.Text style={{ position: 'absolute', bottom: insets.bottom + 40, fontSize: 12, color: 'rgba(255,255,255,0.55)', opacity: hint }}>
          {finished && !ready ? 'Getting things ready…' : 'Tap to continue'}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}
