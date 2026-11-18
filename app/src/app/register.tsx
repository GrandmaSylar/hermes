import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import {
  EMPTY_DRAFT,
  ID_TYPE_LABELS,
  fullName,
  type Gender,
  type IdType,
  type RegistrationDraft,
  type RegistrationErrors,
  type RegistrationItem,
} from '@/domain/registration';
import { useApp } from '@/state/AppProvider';
import { registerMember } from '@/sync/register';
import { Button, Card, Field, colors } from '@/ui/theme';

const ID_TYPES = Object.keys(ID_TYPE_LABELS) as IdType[];

function Choice<T extends string>(props: {
  label: string;
  options: { value: T; label: string }[];
  value: T | '';
  onChange: (value: T) => void;
  error?: string;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 6, fontWeight: '500' }}>{props.label}</Text>
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
      {props.error ? <Text style={{ color: colors.danger, fontSize: 13, marginTop: 6 }}>{props.error}</Text> : null}
    </View>
  );
}

export default function RegisterScreen() {
  const { repos, session, newId, touch, syncNow } = useApp();
  const [draft, setDraft] = useState<RegistrationDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<RegistrationErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<RegistrationItem | null>(null);

  if (!repos || !session) return null;

  const set = <K extends keyof RegistrationDraft>(key: K, value: RegistrationDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await registerMember(repos, session, draft, newId);
      if (!result.ok) {
        setErrors(result.errors);
        setMessage(result.message ?? 'Please correct the highlighted fields.');
        return;
      }
      setSaved(result.item);
      touch();
      void syncNow();
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Card>
          <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ok }}>Registration saved</Text>
          <Text style={{ color: colors.text, marginTop: 12, fontSize: 22, fontWeight: '700' }}>{fullName(saved)}</Text>
          <Text style={{ color: colors.muted, marginTop: 2 }}>{saved.phone}</Text>
          <Text style={{ color: colors.muted, marginTop: 12, fontSize: 12 }}>
            Waiting for the office to approve. The member gets a member number after approval and cannot save or borrow
            until then, so do not collect cash for them yet.
          </Text>
          <Text style={{ color: colors.muted, marginTop: 8, fontSize: 12 }}>
            Ref {saved.localRegistrationId.slice(0, 8).toUpperCase()}
          </Text>
        </Card>
        <Button title="Done" onPress={() => router.dismissTo('/(tabs)')} />
        <Button
          title="Register another member"
          variant="secondary"
          onPress={() => {
            setSaved(null);
            setDraft(EMPTY_DRAFT);
            setErrors({});
            setMessage(null);
          }}
        />
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <Field label="First name" value={draft.firstName} onChangeText={(t) => set('firstName', t)} error={errors.firstName} autoCapitalize="words" maxLength={40} />
        <Field label="Last name" value={draft.lastName} onChangeText={(t) => set('lastName', t)} error={errors.lastName} autoCapitalize="words" maxLength={40} />
        <Choice<Gender>
          label="Gender"
          value={draft.gender}
          onChange={(v) => set('gender', v)}
          error={errors.gender}
          options={[
            { value: 'F', label: 'Female' },
            { value: 'M', label: 'Male' },
          ]}
        />
        <Field
          label="Date of birth (YYYY-MM-DD)"
          value={draft.dateOfBirth}
          onChangeText={(t) => set('dateOfBirth', t)}
          error={errors.dateOfBirth}
          keyboardType="numbers-and-punctuation"
          placeholder="1990-04-23"
          maxLength={10}
        />
        <Field label="Mobile number" value={draft.phone} onChangeText={(t) => set('phone', t)} error={errors.phone} keyboardType="phone-pad" placeholder="024 123 4567" maxLength={16} />
        <Choice<IdType>
          label="ID type"
          value={draft.idType}
          onChange={(v) => set('idType', v)}
          error={errors.idType}
          options={ID_TYPES.map((t) => ({ value: t, label: ID_TYPE_LABELS[t] }))}
        />
        <Field
          label="ID number"
          value={draft.idNumber}
          onChangeText={(t) => set('idNumber', t)}
          error={errors.idNumber}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder={draft.idType === 'GHANA_CARD' ? 'GHA-123456789-0' : ''}
          maxLength={24}
        />
        <Field label="Where the member lives" value={draft.address} onChangeText={(t) => set('address', t)} error={errors.address} maxLength={120} />

        {message ? <Text style={{ color: colors.danger, marginBottom: 12 }}>{message}</Text> : null}
        <Button title="Save registration" onPress={() => void save()} busy={saving} />
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 12 }}>
          Saved on this phone first, then sent to the office automatically. ID photo and signature capture come in a later update.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
