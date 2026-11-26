import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import { Animated, Text, TextInput, View, type TextInputProps } from 'react-native';
import type { OutboxStatus } from '@/domain/types';
import { colors } from '@/ui/colors';
import { Dots, PressScale } from '@/ui/motion';

export { colors };

export const statusStyle = (status: OutboxStatus): { label: string; fg: string; bg: string } =>
  ({
    PENDING: { label: 'Waiting to sync', fg: colors.warn, bg: colors.warnBg },
    SENDING: { label: 'Syncing…', fg: colors.primary, bg: colors.primarySoft },
    SYNCED: { label: 'Pending approval', fg: colors.ok, bg: colors.okBg },
    REJECTED: { label: 'Rejected', fg: colors.danger, bg: colors.dangerBg },
    CONFLICT: { label: 'Needs attention', fg: colors.danger, bg: colors.dangerBg },
  })[status];

/** The look shared by every card and sheet. */
export const RADIUS = { borderCurve: 'continuous' as const };
export const SHADOW = { boxShadow: '0 1px 2px rgba(16, 24, 40, 0.06), 0 2px 8px rgba(16, 24, 40, 0.04)' };

/** A balance for display, or a plain note when the core system does not supply it. */
export function balanceText(value: string | null, format: (amount: string) => string): string {
  return value === null ? 'Not available' : `GHS ${format(value)}`;
}

export function Button(props: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const variant = props.variant ?? 'primary';
  const inactive = props.disabled || props.busy;
  const filled = variant === 'primary';
  const fg = filled ? colors.primaryText : variant === 'danger' ? colors.danger : colors.primary;
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={props.title}
      accessibilityState={{ disabled: !!inactive, busy: !!props.busy }}
      disabled={inactive}
      onPress={props.onPress}
      scaleTo={0.98}
      style={{
        minHeight: 54,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 20,
        opacity: props.disabled && !props.busy ? 0.45 : 1,
        backgroundColor: filled ? colors.primary : variant === 'danger' ? colors.dangerBg : colors.primarySoft,
        ...RADIUS,
        ...(filled && !inactive ? { boxShadow: '0 6px 16px rgba(25, 118, 210, 0.32)' } : {}),
      }}
    >
      {props.busy ? <Dots color={fg} size={7} /> : <Text style={{ color: fg, fontSize: 15, fontWeight: '700', letterSpacing: -0.2 }}>{props.title}</Text>}
    </PressScale>
  );
}

/** A labelled text box: filled, rounded, with a ring that fades in when it has focus. */
export function Field(props: TextInputProps & { label: string; error?: string | null }) {
  const { label, error, style, onFocus, onBlur, ...rest } = props;
  const [focused, setFocused] = useState(false);
  const ring = useRef(new Animated.Value(0)).current;
  const to = (v: number) => Animated.timing(ring, { toValue: v, duration: 160, useNativeDriver: false }).start();
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontSize: 12, color: focused ? colors.primary : colors.muted, marginBottom: 6, fontWeight: '600', marginLeft: 2 }}>{label}</Text>
      <Animated.View
        style={{
          borderRadius: 14,
          borderWidth: 1.5,
          backgroundColor: ring.interpolate({ inputRange: [0, 1], outputRange: [colors.fill, colors.card] }),
          borderColor: error ? colors.danger : ring.interpolate({ inputRange: [0, 1], outputRange: [colors.fill, colors.primary] }),
          ...RADIUS,
        }}
      >
        <TextInput
          placeholderTextColor={colors.muted}
          onFocus={(e) => {
            setFocused(true);
            to(1);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            to(0);
            onBlur?.(e);
          }}
          style={[{ minHeight: 52, paddingHorizontal: 14, fontSize: 15, color: colors.text }, style]}
          {...rest}
        />
      </Animated.View>
      {error ? <Text style={{ color: colors.danger, fontSize: 12, marginTop: 6, marginLeft: 2 }}>{error}</Text> : null}
    </View>
  );
}

export function StatusPill({ status }: { status: OutboxStatus }) {
  const s = statusStyle(status);
  return (
    <View style={{ alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: s.bg }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: s.fg }}>{s.label}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[{ backgroundColor: colors.card, borderRadius: 20, padding: 18, ...RADIUS, ...SHADOW }, style]}>{children}</View>;
}

/** A small capital heading above a group of cards, as in iOS settings. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontSize: 12, fontWeight: '700', color: colors.muted, letterSpacing: 0.6, marginLeft: 4, textTransform: 'uppercase' }}>{children}</Text>;
}

/** A round badge with a person's initials. */
export function Avatar({ name, size = 56, tone = 'blue', photo }: { name: string; size?: number; tone?: 'blue' | 'soft'; photo?: string | null }) {
  const letters = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
  const soft = tone === 'soft';
  if (photo) {
    return <Image source={{ uri: photo }} transition={250} contentFit="cover" accessibilityLabel={`${name}'s photo`} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primarySoft }} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: soft ? colors.primarySoft : colors.primary, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: soft ? colors.primaryDeep : colors.primaryText, fontSize: size * 0.34, fontWeight: '700' }}>{letters}</Text>
    </View>
  );
}
