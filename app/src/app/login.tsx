import { Redirect } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { ApiError } from '@/data/api/contract';
import { useApp } from '@/state/AppProvider';
import { Button, Field, colors } from '@/ui/theme';

type Step = 'password' | 'otp';

export default function Login() {
  const { status, signInPassword, signInOtp, unlock, apiMode } = useApp();
  const [step, setStep] = useState<Step>('password');
  const [staffId, setStaffId] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'ready') return <Redirect href="/(tabs)" />;

  const message = (e: unknown) =>
    e instanceof ApiError && e.kind === 'NETWORK'
      ? 'No connection. First sign-in on a device needs the network.'
      : e instanceof Error
        ? e.message
        : 'Something went wrong.';

  const submitPassword = async () => {
    setBusy(true);
    setError(null);
    try {
      const challenge = await signInPassword(staffId, password);
      // No challenge means the server signed us in without an SMS code.
      if (challenge !== null) {
        setChallengeId(challenge);
        setStep('otp');
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const submitOtp = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInOtp(challengeId, otp.trim());
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const doUnlock = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!(await unlock())) setError('Unlock was cancelled or this phone has no screen lock set.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: 28, fontWeight: '700', color: colors.text }}>QSS Mobile Banking</Text>
        <Text style={{ color: colors.muted, marginTop: 4, marginBottom: apiMode === 'mock' ? 12 : 28 }}>Field collections</Text>
        {apiMode === 'mock' ? (
          <Text style={{ color: colors.warn, backgroundColor: colors.warnBg, padding: 10, borderRadius: 8, marginBottom: 20 }}>
            Demo mode: this build is not connected to the core banking system. Nothing you enter reaches the office.
          </Text>
        ) : null}

        {status === 'locked' ? (
          <View>
            <Text style={{ color: colors.text, marginBottom: 16 }}>Unlock with your fingerprint, face or phone screen lock.</Text>
            <Button title="Unlock" onPress={doUnlock} busy={busy} />
          </View>
        ) : step === 'password' ? (
          <View>
            <Field label="Staff ID" value={staffId} onChangeText={setStaffId} autoCapitalize="characters" autoCorrect={false} />
            <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
            <Button title="Continue" onPress={submitPassword} busy={busy} disabled={!staffId.trim() || !password} />
          </View>
        ) : (
          <View>
            <Text style={{ color: colors.text, marginBottom: 16 }}>Enter the 6-digit code sent to your phone by SMS.</Text>
            <Field label="Code" value={otp} onChangeText={setOtp} keyboardType="number-pad" maxLength={6} />
            <Button title="Verify" onPress={submitOtp} busy={busy} disabled={otp.trim().length !== 6} />
            <View style={{ height: 12 }} />
            <Button title="Back" variant="secondary" onPress={() => setStep('password')} disabled={busy} />
          </View>
        )}

        {error ? <Text style={{ color: colors.danger, marginTop: 16 }}>{error}</Text> : null}

        {__DEV__ && apiMode === 'mock' && status !== 'locked' ? (
          <Text style={{ color: colors.muted, marginTop: 32, fontSize: 12 }}>
            Development mock: staff ID FO001, password Passw0rd!, code 123456.
          </Text>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
