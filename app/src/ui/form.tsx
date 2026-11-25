import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, Switch, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors } from '@/ui/theme';

/** Building blocks for the member registration form. */

export interface Option {
  value: string;
  label: string;
}

export const toOptions = (values: readonly string[]): Option[] => values.map((v) => ({ value: v, label: v }));

const labelStyle = { fontSize: 13, color: colors.muted, marginBottom: 6, fontWeight: '500' as const };

export function Required({ label, required }: { label: string; required?: boolean }) {
  return (
    <Text style={labelStyle}>
      {label}
      {required ? <Text style={{ color: colors.danger }}> *</Text> : null}
    </Text>
  );
}

function Help({ error, help }: { error?: string | null; help?: string }) {
  if (error) return <Text style={{ color: colors.danger, fontSize: 13, marginTop: 6 }}>{error}</Text>;
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
  },
) {
  const { label, value, onChange, required, error, help, style, multiline, ...rest } = props;
  return (
    <View style={{ marginBottom: 14 }}>
      <Required label={label} required={required} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholderTextColor={colors.muted}
        multiline={multiline}
        style={[
          {
            minHeight: multiline ? 84 : 48,
            borderWidth: 1,
            borderColor: error ? colors.danger : colors.border,
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: multiline ? 10 : 0,
            fontSize: 16,
            backgroundColor: colors.card,
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
                minHeight: 44,
                paddingHorizontal: 14,
                borderRadius: 10,
                borderWidth: 1,
                justifyContent: 'center',
                borderColor: selected ? colors.primary : props.error ? colors.danger : colors.border,
                backgroundColor: selected ? '#EAF1FF' : colors.card,
              }}
            >
              <Text style={{ color: colors.text, fontWeight: selected ? '700' : '500' }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Help error={props.error} />
    </View>
  );
}

/** A longer list picked from a sheet that slides up, with a search box when the list is long. */
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
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? props.options.filter((o) => o.label.toLowerCase().includes(f)) : props.options;
  }, [filter, props.options]);
  const current = props.options.find((o) => o.value === props.value);
  const searchable = props.options.length > 12;

  const close = () => {
    setOpen(false);
    setFilter('');
  };

  return (
    <View style={{ marginBottom: 14 }}>
      <Required label={props.label} required={props.required} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.label}
        disabled={props.disabled}
        onPress={() => setOpen(true)}
        style={{
          minHeight: 48,
          borderWidth: 1,
          borderColor: props.error ? colors.danger : colors.border,
          borderRadius: 10,
          paddingHorizontal: 12,
          justifyContent: 'center',
          backgroundColor: colors.card,
          opacity: props.disabled ? 0.5 : 1,
        }}
      >
        <Text style={{ fontSize: 16, color: current ? colors.text : colors.muted }}>
          {current ? current.label : props.placeholder ?? 'Choose'}
        </Text>
      </Pressable>
      <Help error={props.error} help={props.help} />

      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(16,24,40,0.45)' }} onPress={close} />
        <View style={{ maxHeight: '70%', backgroundColor: colors.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, paddingHorizontal: 16, paddingBottom: 8 }}>{props.label}</Text>
          {searchable ? (
            <TextInput
              value={filter}
              onChangeText={setFilter}
              placeholder="Search"
              placeholderTextColor={colors.muted}
              autoCorrect={false}
              style={{
                marginHorizontal: 16,
                marginBottom: 8,
                minHeight: 44,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                paddingHorizontal: 12,
                color: colors.text,
              }}
            />
          ) : null}
          <FlatList
            data={shown}
            keyExtractor={(o) => o.value}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  props.onChange(item.value);
                  close();
                }}
                style={({ pressed }) => ({
                  paddingVertical: 14,
                  paddingHorizontal: 16,
                  backgroundColor: pressed ? '#EEF2F6' : item.value === props.value ? '#EAF1FF' : colors.card,
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                })}
              >
                <Text style={{ fontSize: 16, color: colors.text, fontWeight: item.value === props.value ? '700' : '400' }}>{item.label}</Text>
              </Pressable>
            )}
            ListEmptyComponent={<Text style={{ color: colors.muted, padding: 16 }}>Nothing matches.</Text>}
          />
          {props.value !== '' && !props.required ? (
            <Pressable
              onPress={() => {
                props.onChange('');
                close();
              }}
              style={{ padding: 16, borderTopWidth: 1, borderTopColor: colors.border }}
            >
              <Text style={{ color: colors.danger, fontWeight: '600' }}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

/** An on/off setting with its explanation. */
export function SwitchRow(props: { label: string; help?: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, color: colors.text, fontWeight: '500' }}>{props.label}</Text>
        {props.help ? <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{props.help}</Text> : null}
      </View>
      <Switch value={props.value} onValueChange={props.onChange} trackColor={{ true: colors.primary }} />
    </View>
  );
}

export function SectionTitle({ children }: { children: string }) {
  return <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 8, marginBottom: 12 }}>{children}</Text>;
}

/** The problems found on a step, listed together at the top as the office form does. */
export function ProblemBox({ problems }: { problems: { message: string }[] }) {
  if (problems.length === 0) return null;
  return (
    <View style={{ backgroundColor: colors.dangerBg, borderRadius: 10, padding: 12, marginBottom: 14 }}>
      <Text style={{ color: colors.danger, fontWeight: '700', marginBottom: 4 }}>Please correct the following</Text>
      {problems.map((p, i) => (
        <Text key={i} style={{ color: colors.danger, fontSize: 13, marginTop: 2 }}>
          • {p.message}
        </Text>
      ))}
    </View>
  );
}

/** A warning that something the form is about to use already belongs to another member. */
export function NoticeBox({ tone, children }: { tone: 'warn' | 'info'; children: React.ReactNode }) {
  const bg = tone === 'warn' ? colors.warnBg : '#EAF1FF';
  const fg = tone === 'warn' ? colors.warn : colors.primary;
  return (
    <View style={{ backgroundColor: bg, borderRadius: 10, padding: 12, marginBottom: 14 }}>
      <Text style={{ color: fg, fontSize: 13 }}>{children}</Text>
    </View>
  );
}
