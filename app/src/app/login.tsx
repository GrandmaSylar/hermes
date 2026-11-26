import { Ionicons } from '@expo/vector-icons';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@/data/api/contract';
import { useApp } from '@/state/AppProvider';
import { Reveal, tap } from '@/ui/motion';
import { Button, Field, RADIUS, colors } from '@/ui/theme';

type Step = 'password' | 'otp';

export default function Login() {
  const { status, signInPassword, signInOtp, unlock, apiMode } = useApp();
  const insets = useSafeAreaInsets();
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

  const fail = (e: unknown) => {
    tap('error');
    setError(message(e));
  };

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
      fail(e);
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
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const doUnlock = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!(await unlock())) {
        tap('error');
        setError('Unlock was cancelled or this phone has no screen lock set.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" bounces={false}>
        {/* Brand header */}
        <View
          style={{
            paddingTop: insets.top + 48,
            paddingBottom: 84,
            paddingHorizontal: 28,
            gap: 14,
            backgroundColor: colors.primary,
            experimental_backgroundImage: `linear-gradient(160deg, ${colors.primary}, ${colors.primaryDeep})`,
            borderBottomLeftRadius: 36,
            borderBottomRightRadius: 36,
            ...RADIUS,
          }}
        >
          <Reveal>
            <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', ...RADIUS }}>
              <Ionicons name="wallet" size={32} color="#FFFFFF" />
            </View>
          </Reveal>
          <Reveal index={1}>
            <Text style={{ fontSize: 32, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.6 }}>QSS Mobile Banking</Text>
            <Text style={{ fontSize: 16, color: 'rgba(255,255,255,0.82)', marginTop: 4 }}>Field collections and member registration</Text>
          </Reveal>
        </View>

        {/* Form card, overlapping the header */}
        <View style={{ paddingHorizontal: 16, marginTop: -48, paddingBottom: insets.bottom + 24, gap: 16 }}>
          <Reveal index={2} from={24}>
            <View style={{ backgroundColor: colors.card, borderRadius: 28, padding: 22, ...RADIUS, boxShadow: '0 12px 32px rgba(16, 24, 40, 0.12)' }}>
              {apiMode === 'mock' ? (
                <View style={{ backgroundColor: colors.warnBg, padding: 12, borderRadius: 12, marginBottom: 18 }}>
                  <Text style={{ color: colors.warn, fontSize: 13 }}>Demo mode: this build is not connected to the core banking system. Nothing you enter reaches the office.</Text>
                </View>
              ) : null}

              {status === 'locked' ? (
                <View style={{ gap: 16 }}>
                  <View style={{ alignItems: 'center', gap: 10, paddingVertical: 8 }}>
                    <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="finger-print" size={34} color={colors.primary} />
                    </View>
                    <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>Welcome back</Text>
                    <Text style={{ color: colors.muted, textAlign: 'center' }}>Unlock with your fingerprint, face or phone screen lock.</Text>
                  </View>
                  <Button title="Unlock" onPress={doUnlock} busy={busy} />
                </View>
              ) : step === 'password' ? (
                <View>
                  <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text, letterSpacing: -0.3, marginBottom: 4 }}>Sign in</Text>
                  <Text style={{ color: colors.muted, marginBottom: 20 }}>Use the staff ID and PIN the office gave you.</Text>
                  <Field label="Staff ID" value={staffId} onChangeText={setStaffId} autoCapitalize={apiMode === 'http' ? 'none' : 'characters'} autoCorrect={false} />
                  <Field label={apiMode === 'http' ? 'PIN' : 'Password'} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
                  <Button title="Continue" onPress={submitPassword} busy={busy} disabled={!staffId.trim() || !password} />
                </View>
              ) : (
                <View>
                  <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text, letterSpacing: -0.3, marginBottom: 4 }}>Check your phone</Text>
                  <Text style={{ color: colors.muted, marginBottom: 20 }}>Enter the 6-digit code sent to you by SMS.</Text>
                  <Field label="Code" value={otp} onChangeText={setOtp} keyboardType="number-pad" maxLength={6} style={{ fontSize: 24, letterSpacing: 8, fontWeight: '700' }} />
                  <Button title="Verify" onPress={submitOtp} busy={busy} disabled={otp.trim().length !== 6} />
                  <View style={{ height: 10 }} />
                  <Button title="Back" variant="secondary" onPress={() => setStep('password')} disabled={busy} />
                </View>
              )}

              {error ? (
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 16, padding: 12, borderRadius: 12, backgroundColor: colors.dangerBg }}>
                  <Ionicons name="alert-circle" size={18} color={colors.danger} style={{ marginTop: 1 }} />
                  <Text selectable style={{ flex: 1, color: colors.danger }}>{error}</Text>
                </View>
              ) : null}
            </View>
          </Reveal>

          {__DEV__ && apiMode === 'mock' && status !== 'locked' ? (
            <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center' }}>Development mock: staff ID FO001, password Passw0rd!, code 123456.</Text>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
