import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, Switch, Text, TextInput, View, type TextInputProps } from 'react-native';
import { Dropdown } from '@/ui/dropdown';
import { colors } from '@/ui/theme';

/** Building blocks for the member registration form. */

export interface Option {
  value: string;
  label: string;
}

export const toOptions = (values: readonly string[]): Option[] => values.map((v) => ({ value: v, label: v }));

const labelStyle = () => ({ fontSize: 12, color: colors.muted, marginBottom: 6, marginLeft: 2, fontWeight: '600' as const });

export function Required({ label, required }: { label: string; required?: boolean }) {
  return (
    <Text style={labelStyle()}>
      {label}
      {required ? <Text style={{ color: colors.danger }}> *</Text> : null}
    </Text>
  );
}

function Help({ error, help }: { error?: string | null; help?: string }) {
  if (error) return <Text style={{ color: colors.danger, fontSize: 12, marginTop: 6 }}>{error}</Text>;
  if (help) return <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>{help}</Text>;
  return null;
}

/** A text box with a label, an optional hint, and a red message when the value is wrong. */
export function TextField(
  props: Omit<TextInputProps, 'onChangeText' | 'onChange' | 'value'> & {
    label: string;
    value: string;
    onChange: (value: string) => void;
    required?: boolean;
    error?: string | null;
    help?: string;
    /** No space below, for a field that sits in a row with something else. */
    flush?: boolean;
  },
) {
  const { label, value, onChange, required, error, help, style, multiline, onFocus, onBlur, flush, ...rest } = props;
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: flush ? 0 : 14 }}>
      <Required label={label} required={required} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholderTextColor={colors.muted}
        multiline={multiline}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          {
            minHeight: multiline ? 88 : 52,
            borderWidth: 1.5,
            borderColor: error ? colors.danger : focused ? colors.primary : colors.fill,
            borderRadius: 14,
            borderCurve: 'continuous',
            paddingHorizontal: 14,
            paddingVertical: multiline ? 12 : 0,
            fontSize: 15,
            backgroundColor: focused ? colors.card : colors.fill,
            color: colors.text,
            textAlignVertical: multiline ? 'top' : 'center',
          },
          style,
        ]}
        {...rest}
      />
      <Help error={error} help={help} />
    </View>
  );
}

/** A short list shown as buttons in a row (gender, yes/no). */
export function ChoiceField(props: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  required?: boolean;
  error?: string | null;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Required label={props.label} required={props.required} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {props.options.map((o) => {
          const selected = props.value === o.value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => props.onChange(o.value)}
              style={{
                minHeight: 46,
                paddingHorizontal: 16,
                borderRadius: 14,
                borderCurve: 'continuous',
                borderWidth: 1.5,
                justifyContent: 'center',
                borderColor: selected ? colors.primary : props.error ? colors.danger : colors.fill,
                backgroundColor: selected ? colors.primarySoft : colors.fill,
              }}
            >
              <Text style={{ color: selected ? colors.primaryDeep : colors.text, fontWeight: selected ? '700' : '500' }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Help error={props.error} />
    </View>
  );
}

/** A pick-one list. Short lists drop down under the field; long ones open as a searchable sheet (see Dropdown). */
export function SelectField(props: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  required?: boolean;
  error?: string | null;
  help?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return <Dropdown {...props} renderLabel={(label, required) => <Required label={label} required={required} />} />;
}

/** An on/off setting with its explanation. */
export function SwitchRow(props: { label: string; help?: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, color: colors.text, fontWeight: '500' }}>{props.label}</Text>
        {props.help ? <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{props.help}</Text> : null}
      </View>
      <Switch value={props.value} onValueChange={props.onChange} trackColor={{ true: colors.primary }} />
    </View>
  );
}

export function SectionTitle({ children }: { children: string }) {
  return <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 8, marginBottom: 12, letterSpacing: -0.2 }}>{children}</Text>;
}

/** The problems found on a step, listed together at the top as the office form does. */
export function ProblemBox({ problems }: { problems: { message: string }[] }) {
  if (problems.length === 0) return null;
  return (
    <View style={{ backgroundColor: colors.dangerBg, borderRadius: 14, borderCurve: 'continuous', padding: 14, marginBottom: 14 }}>
      <Text style={{ color: colors.danger, fontWeight: '700', marginBottom: 4 }}>Please correct the following</Text>
      {problems.map((p, i) => (
        <Text key={i} style={{ color: colors.danger, fontSize: 12, marginTop: 2 }}>
          • {p.message}
        </Text>
      ))}
    </View>
  );
}

/** A warning that something the form is about to use already belongs to another member. */
export function NoticeBox({ tone, children }: { tone: 'warn' | 'info'; children: React.ReactNode }) {
  const bg = tone === 'warn' ? colors.warnBg : colors.primarySoft;
  const fg = tone === 'warn' ? colors.warn : colors.primaryDeep;
  return (
    <View style={{ backgroundColor: bg, borderRadius: 14, borderCurve: 'continuous', padding: 14, marginBottom: 14 }}>
      <Text style={{ color: fg, fontSize: 12 }}>{children}</Text>
    </View>
  );
}

/** Two short fields side by side. */
export function Pair({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', gap: 12 }}>{React.Children.map(children, (c) => <View style={{ flex: 1 }}>{c}</View>)}</View>;
}

/** A white card around a few related fields, with an optional small heading. */
export function Group({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 20, borderCurve: 'continuous', padding: 16, paddingBottom: 4, boxShadow: '0 1px 2px rgba(16, 24, 40, 0.06), 0 2px 8px rgba(16, 24, 40, 0.04)' }}>
      {title ? <Text style={{ fontSize: 12, fontWeight: '700', color: colors.muted, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 12 }}>{title}</Text> : null}
      {children}
    </View>
  );
}

/** Rarely needed fields, folded away until asked for. Opens by itself if one of them is filled or wrong. */
export function Disclosure({ title, open: forced, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const shown = open || forced === true;
  return (
    <View style={{ marginBottom: 12 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: shown }} onPress={() => setOpen(!shown)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
        <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '600' }}>{shown ? 'Show less' : title}</Text>
        <Ionicons name={shown ? 'chevron-up' : 'chevron-down'} size={16} color={colors.primary} />
      </Pressable>
      {shown ? <View style={{ marginTop: 8 }}>{children}</View> : null}
    </View>
  );
}

/** A row in a Group: a label and a switch, separated from the next by a hairline. */
export function ToggleLine({ label, value, onChange, last }: { label: string; value: boolean; onChange: (v: boolean) => void; last?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border, marginBottom: last ? 8 : 0 }}>
      <Text style={{ flex: 1, fontSize: 15, color: colors.text }}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary }} />
    </View>
  );
}
