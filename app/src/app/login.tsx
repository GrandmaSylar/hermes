import { Ionicons } from '@expo/vector-icons';
import { Redirect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@/data/api/contract';
import { useApp } from '@/state/AppProvider';
import { Reveal, tap } from '@/ui/motion';
import { CuaLogo } from '@/ui/brand';
import { brand, brandGradient } from '@/ui/colors';
import { Button, Field, RADIUS, colors } from '@/ui/theme';

type Step = 'password' | 'otp';

export default function Login() {
  const { status, signInPassword, signInOtp, unlock, apiMode } = useApp();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
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
    <View style={{ flex: 1, backgroundColor: brand.navy, experimental_backgroundImage: brandGradient(160) }}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" bounces={false}>
          {/* The association's logo on a white, curved-edged panel: the logo is navy and red, so it needs a light ground */}
          <View
            style={{
              alignItems: 'center',
              paddingTop: insets.top + 20,
              paddingBottom: 36,
              backgroundColor: '#FFFFFF',
              borderBottomLeftRadius: 44,
              borderBottomRightRadius: 44,
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.25)',
              ...RADIUS,
            }}
          >
            <Reveal>
              <CuaLogo width={Math.min(300, width - 80)} />
            </Reveal>
          </View>

          <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 24, paddingBottom: insets.bottom + 24, gap: 18 }}>
            <Reveal index={1} from={24}>
              <View style={{ backgroundColor: colors.card, borderRadius: 28, padding: 22, ...RADIUS, boxShadow: '0 16px 40px rgba(0, 0, 0, 0.3)' }}>
                {apiMode === 'mock' ? (
                  <View style={{ backgroundColor: colors.warnBg, padding: 12, borderRadius: 12, marginBottom: 18 }}>
                    <Text style={{ color: colors.warn, fontSize: 12 }}>Demo mode. Nothing reaches the office.</Text>
                  </View>
                ) : null}

                {status === 'locked' ? (
                  <View style={{ gap: 16 }}>
                    <View style={{ alignItems: 'center', gap: 10, paddingVertical: 8 }}>
                      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="finger-print" size={34} color={brand.navy} />
                      </View>
                      <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>Welcome back</Text>
                      <Text style={{ color: colors.muted, textAlign: 'center' }}>Use your fingerprint, face or screen lock</Text>
                    </View>
                    <Button title="Unlock" onPress={doUnlock} busy={busy} />
                  </View>
                ) : step === 'password' ? (
                  <View>
                    <Text style={{ fontSize: 12, fontWeight: '700', letterSpacing: 1, color: brand.red }}>QSS MOBILE BANKING</Text>
                    <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text, letterSpacing: -0.4, marginTop: 2 }}>Sign in</Text>
                    <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: brand.red, marginTop: 8, marginBottom: 12 }} />
                    <Text style={{ color: colors.muted, marginBottom: 20 }}>Staff ID and PIN</Text>
                    <Field label="Staff ID" value={staffId} onChangeText={setStaffId} autoCapitalize={apiMode === 'http' ? 'none' : 'characters'} autoCorrect={false} />
                    <Field label={apiMode === 'http' ? 'PIN' : 'Password'} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
                    <Button title="Continue" onPress={submitPassword} busy={busy} disabled={!staffId.trim() || !password} />
                  </View>
                ) : (
                  <View>
                    <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text, letterSpacing: -0.4 }}>Check your phone</Text>
                    <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: brand.red, marginTop: 8, marginBottom: 12 }} />
                    <Text style={{ color: colors.muted, marginBottom: 20 }}>The 6-digit code sent by SMS</Text>
                    <Field label="Code" value={otp} onChangeText={setOtp} keyboardType="number-pad" maxLength={6} style={{ fontSize: 20, letterSpacing: 8, fontWeight: '700' }} />
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

            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, textAlign: 'center' }}>Secure field banking for credit unions</Text>
            {__DEV__ && apiMode === 'mock' && status !== 'locked' ? (
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, textAlign: 'center' }}>Development mock: staff ID FO001, password Passw0rd!, code 123456.</Text>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
