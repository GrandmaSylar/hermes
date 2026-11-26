import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { useApp } from '@/state/AppProvider';
import { Button } from '@/ui/theme';
import { Dots, Reveal, isReduceMotion } from '@/ui/motion';
import { colors } from '@/ui/colors';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * What a list or screen shows when there is nothing to show, or something went wrong: an icon that gently floats,
 * what it means, and (when there is something to do about it) one button. One look, used everywhere, so people
 * learn it.
 */
export function EmptyState(props: { icon: IconName; title: string; body?: string; tone?: 'quiet' | 'error'; action?: { label: string; onPress: () => void } }) {
  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (isReduceMotion()) return;
    const loop = Animated.loop(Animated.sequence([Animated.timing(float, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }), Animated.timing(float, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true })]));
    loop.start();
    return () => loop.stop();
  }, [float]);
  const error = props.tone === 'error';
  return (
    <Reveal style={{ alignItems: 'center', gap: 8, paddingVertical: 32, paddingHorizontal: 24 }}>
      <Animated.View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: error ? colors.dangerBg : colors.primarySoft, alignItems: 'center', justifyContent: 'center', transform: [{ translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) }] }}>
        <Ionicons name={props.icon} size={30} color={error ? colors.danger : colors.primary} />
      </Animated.View>
      <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, textAlign: 'center', marginTop: 4 }}>{props.title}</Text>
      {props.body ? <Text style={{ fontSize: 14, color: colors.muted, textAlign: 'center' }}>{props.body}</Text> : null}
      {props.action ? (
        <View style={{ marginTop: 10, alignSelf: 'stretch', paddingHorizontal: 24 }}>
          <Button title={props.action.label} variant="secondary" onPress={props.action.onPress} />
        </View>
      ) : null}
    </Reveal>
  );
}

/**
 * A slim banner under the status bar that says where the connection stands: offline (items are safe and will
 * send), then "back online, sending", then a brief "all caught up". Silent while everything is normal.
 */
export function ConnectionBanner({ top }: { top: number }) {
  const { online, syncing } = useApp();
  const [phase, setPhase] = useState<'hidden' | 'offline' | 'sending' | 'done'>('hidden');
  const was = useRef<'online' | 'offline'>('online');
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!online) {
      was.current = 'offline';
      setPhase('offline');
    } else if (was.current === 'offline') {
      setPhase(syncing ? 'sending' : 'done');
      if (!syncing) {
        was.current = 'online';
        const timer = setTimeout(() => setPhase('hidden'), 2200);
        return () => clearTimeout(timer);
      }
    }
  }, [online, syncing]);

  useEffect(() => {
    Animated.timing(slide, { toValue: phase === 'hidden' ? 0 : 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [phase, slide]);

  const look = {
    hidden: { bg: colors.warnBg, fg: colors.warn, icon: 'cloud-offline-outline' as IconName, text: '' },
    offline: { bg: colors.warnBg, fg: colors.warn, icon: 'cloud-offline-outline' as IconName, text: 'Offline. Your deposits are saved and will send when you are back.' },
    sending: { bg: colors.primarySoft, fg: colors.primaryDeep, icon: 'sync-outline' as IconName, text: 'Back online. Sending…' },
    done: { bg: colors.okBg, fg: colors.ok, icon: 'checkmark-circle-outline' as IconName, text: 'All caught up' },
  }[phase];

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top,
        left: 16,
        right: 16,
        opacity: slide,
        transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 14, borderCurve: 'continuous', backgroundColor: look.bg, boxShadow: '0 6px 18px rgba(0, 0, 0, 0.14)' }}>
        <Ionicons name={look.icon} size={18} color={look.fg} />
        <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: look.fg }}>{look.text}</Text>
        {phase === 'sending' ? <Dots size={5} color={look.fg} /> : null}
      </View>
    </Animated.View>
  );
}
