import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '@/ui/colors';

/**
 * Motion for the whole app, built on React Native's own Animated (native driver), so it runs smoothly on
 * entry-level phones and needs no extra native module. Everything respects the phone's "reduce motion" setting.
 */

let reduce = false;
void AccessibilityInfo.isReduceMotionEnabled?.().then((v) => (reduce = v)).catch(() => undefined);
AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => (reduce = v));

/** True when the phone is set to reduce motion, so large animations can be skipped or shortened. */
export const isReduceMotion = () => reduce;

const EASE = Easing.bezier(0.22, 1, 0.36, 1);

/** A light tap, where the phone supports it. Never throws. */
export function tap(kind: 'light' | 'success' | 'error' = 'light') {
  try {
    if (kind === 'light') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    else void Haptics.notificationAsync(kind === 'success' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
  } catch {
    // No haptics on this phone.
  }
}

/** Fades and lifts its content into place. `index` staggers a list so items arrive one after another. */
export function Reveal({ children, index = 0, style, from = 14 }: { children: React.ReactNode; index?: number; style?: StyleProp<ViewStyle>; from?: number }) {
  const progress = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) return;
    Animated.timing(progress, { toValue: 1, duration: 420, delay: Math.min(index, 8) * 55, easing: EASE, useNativeDriver: true }).start();
  }, [progress, index]);
  return (
    <Animated.View style={[{ opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }] }, style]}>{children}</Animated.View>
  );
}

/** A pressable that eases down on touch and gives a light tap. */
export function PressScale({ children, style, haptic = true, scaleTo = 0.97, onPress, ...rest }: PressableProps & { style?: StyleProp<ViewStyle>; haptic?: boolean; scaleTo?: number; children: React.ReactNode }) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (value: number) => Animated.spring(scale, { toValue: value, speed: 40, bounciness: 4, useNativeDriver: true }).start();
  // Layout that belongs to the outer touch area (sharing a row), so the scaled view fills it.
  const flat = StyleSheet.flatten(style) ?? {};
  const outer: ViewStyle = { flex: flat.flex, alignSelf: flat.alignSelf, flexGrow: flat.flexGrow, flexShrink: flat.flexShrink };
  return (
    <Pressable
      {...rest}
      style={outer}
      onPressIn={(e) => {
        if (!reduce) to(scaleTo);
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (!reduce) to(1);
        rest.onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic) tap('light');
        onPress?.(e);
      }}
    >
      <Animated.View style={[{ transform: [{ scale }] }, style, flat.flex !== undefined ? { flex: 1 } : null]}>{children}</Animated.View>
    </Pressable>
  );
}

/** The app's own loader: three dots that rise and fall in turn. */
export function Dots({ color = colors.primary, size = 8 }: { color?: string; size?: number }) {
  const values = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    const loops = values.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 140),
          Animated.timing(v, { toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 320, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          Animated.delay((2 - i) * 140),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [values]);
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading" style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.7, height: size * 2.4 }}>
      {values.map((v, i) => (
        <Animated.View
          key={i}
          style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }), transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.8] }) }] }}
        />
      ))}
    </View>
  );
}

/** Full-screen loader: a ring that breathes around the brand dot, with an optional line of text beneath. */
export function BrandLoader({ size = 72, children }: { size?: number; children?: React.ReactNode }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1500, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const ring = (delay: number) => {
    const phase = Animated.modulo(Animated.add(pulse, delay), 1);
    return {
      opacity: phase.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.5, 0.1, 0] }),
      transform: [{ scale: phase.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1.5] }) }],
    };
  };
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading" style={{ width: size * 1.6, height: size * 1.6, alignItems: 'center', justifyContent: 'center' }}>
      {[0, 0.5].map((d) => (
        <Animated.View key={d} style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: d === 0 ? colors.primary : '#EA3137' }, ring(d)]} />
      ))}
      {children ?? <View style={{ width: size * 0.5, height: size * 0.5, borderRadius: size * 0.25, backgroundColor: colors.primary }} />}
    </View>
  );
}

/** A grey block that shimmers while real content loads. */
export function Skeleton({ width, height = 14, radius = 8, style }: { width?: number | `${number}%`; height?: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(Animated.sequence([Animated.timing(sweep, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }), Animated.timing(sweep, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true })]));
    loop.start();
    return () => loop.stop();
  }, [sweep]);
  return <Animated.View style={[{ width: width ?? '100%', height, borderRadius: radius, backgroundColor: colors.track, opacity: sweep.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) }, style]} />;
}

/** A row-shaped placeholder for lists. */
export function SkeletonRow() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16 }}>
      <Skeleton width={40} height={40} radius={20} />
      <View style={{ flex: 1, gap: 8 }}>
        <Skeleton width="55%" height={14} />
        <Skeleton width="35%" height={11} />
      </View>
      <Skeleton width={64} height={16} />
    </View>
  );
}

/** A tick that draws itself in a circle: shown when something has been saved. */
export function SuccessMark({ size = 84, color = colors.ok }: { size?: number; color?: string }) {
  const pop = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  const check = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) return;
    Animated.sequence([
      Animated.spring(pop, { toValue: 1, speed: 12, bounciness: 10, useNativeDriver: true }),
      Animated.timing(check, { toValue: 1, duration: 260, easing: EASE, useNativeDriver: true }),
    ]).start();
    tap('success');
  }, [pop, check]);
  const stroke = size * 0.09;
  return (
    <Animated.View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pop }], boxShadow: `0 8px 20px ${color}55` }}>
      <Animated.View style={{ opacity: check, transform: [{ scale: check.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }, { rotate: '-45deg' }, { translateY: -size * 0.04 }], width: size * 0.44, height: size * 0.24, borderLeftWidth: stroke, borderBottomWidth: stroke, borderColor: '#FFFFFF', borderBottomLeftRadius: 2 }} />
    </Animated.View>
  );
}
