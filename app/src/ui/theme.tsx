import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import type { OutboxStatus } from '@/domain/types';

export const colors = {
  bg: '#F6F7F9',
  card: '#FFFFFF',
  text: '#101828',
  muted: '#667085',
  border: '#E4E7EC',
  primary: '#0B5FFF',
  primaryText: '#FFFFFF',
  danger: '#B42318',
  dangerBg: '#FEE4E2',
  ok: '#067647',
  okBg: '#DCFAE6',
  warn: '#B54708',
  warnBg: '#FEF0C7',
};

export const STATUS_STYLE: Record<OutboxStatus, { label: string; fg: string; bg: string }> = {
  PENDING: { label: 'Waiting to sync', fg: colors.warn, bg: colors.warnBg },
  SENDING: { label: 'Syncing…', fg: colors.primary, bg: '#D1E0FF' },
  SYNCED: { label: 'Pending approval', fg: colors.ok, bg: colors.okBg },
  REJECTED: { label: 'Rejected', fg: colors.danger, bg: colors.dangerBg },
  CONFLICT: { label: 'Needs attention', fg: colors.danger, bg: colors.dangerBg },
};

/** A balance for display, or a plain note when the core system does not supply it. */
export function balanceText(value: string | null, format: (amount: string) => string): string {
  return value === null ? 'Not available' : `GHS ${format(value)}`;
}

export function Button(props: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  const secondary = props.variant === 'secondary';
  const inactive = props.disabled || props.busy;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        secondary ? styles.buttonSecondary : styles.buttonPrimary,
        inactive && styles.buttonDisabled,
        pressed && !inactive && { opacity: 0.85 },
      ]}
    >
      {props.busy ? (
        <ActivityIndicator color={secondary ? colors.primary : colors.primaryText} />
      ) : (
        <Text style={[styles.buttonText, secondary && { color: colors.primary }]}>{props.title}</Text>
      )}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string; error?: string | null }) {
  const { label, error, style, ...rest } = props;
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        style={[styles.input, error ? { borderColor: colors.danger } : null, style]}
        {...rest}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export function StatusPill({ status }: { status: OutboxStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <View style={[styles.pill, { backgroundColor: s.bg }]}>
      <Text style={[styles.pillText, { color: s.fg }]}>{s.label}</Text>
    </View>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

const styles = StyleSheet.create({
  button: { minHeight: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonSecondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
  label: { fontSize: 13, color: colors.muted, marginBottom: 6, fontWeight: '500' },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.card,
  },
  error: { color: colors.danger, fontSize: 13, marginTop: 6 },
  pill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 12, fontWeight: '600' },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: colors.border },
});
