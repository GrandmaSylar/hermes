import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Animated, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View, type TextInputInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@/data/api/contract';
import { loadStaffId, saveStaffId } from '@/data/remembered-id';
import { useApp } from '@/state/AppProvider';
import { brandGradient, brand } from '@/ui/colors';
import { Reveal, tap } from '@/ui/motion';
import { Button, Field, RADIUS, colors } from '@/ui/theme';

type Step = 'password' | 'otp';

/** A soft ring of light behind the brand, for depth on the dark ground. */
function Glow({ size, top, left, right, opacity }: { size: number; top?: number; left?: number; right?: number; opacity: number }) {
  return <View pointerEvents="none" style={{ position: 'absolute', top, left, right, width: size, height: size, borderRadius: size / 2, backgroundColor: '#FFFFFF', opacity }} />;
}

export default function Login() {
  const { status, session, signInPassword, signInOtp, unlock, apiMode } = useApp();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('password');
  const [staffId, setStaffId] = useState('');
  const [remember, setRemember] = useState(true);
  const [password, setPassword] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [otp, setOtp] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pinRef = useRef<TextInputInstance>(null);
  const shake = useRef(new Animated.Value(0)).current;

  // The ID used last time is already filled in.
  useEffect(() => {
    void loadStaffId().then((saved) => {
      if (saved) setStaffId((current) => current || saved);
    });
  }, []);

  const message = (e: unknown) =>
    e instanceof ApiError && e.kind === 'NETWORK'
      ? 'No connection. First sign-in on a device needs the network.'
      : e instanceof Error
        ? e.message
        : 'Something went wrong.';

  const fail = (e: unknown) => {
    tap('error');
    setError(message(e));
    shake.setValue(0);
    Animated.sequence([-8, 8, -6, 6, -3, 0].map((x) => Animated.timing(shake, { toValue: x, duration: 55, useNativeDriver: true }))).start();
  };

  const canSubmit = staffId.trim() !== '' && password !== '';

  const submitPassword = async () => {
    if (busy || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const challenge = await signInPassword(staffId, password);
      void saveStaffId(remember ? staffId : '');
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
    if (busy || otp.trim().length !== 6) return;
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

  const welcomeName = session?.officerName?.trim().split(/\s+/)[0];

  return (
    <View style={{ flex: 1, backgroundColor: brand.navy, experimental_backgroundImage: brandGradient(160), overflow: 'hidden' }}>
      <StatusBar style="light" />
      <Glow size={320} top={-110} right={-120} opacity={0.05} />
      <Glow size={220} top={140} left={-110} opacity={0.04} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingTop: insets.top + 24, paddingBottom: insets.bottom + 20, paddingHorizontal: 20, gap: 28 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Brand */}
          <Reveal style={{ alignItems: 'center', gap: 10 }}>
            <View style={{ width: 112, height: 112, borderRadius: 56, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' }}>
              <Image source={require('../../assets/qss-logo.png')} contentFit="contain" accessibilityLabel="QSS Core Banking logo" style={{ width: 84, height: 84 }} />
            </View>
            <View style={{ alignItems: 'center', gap: 2 }}>
              <Text style={{ fontSize: 24, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.4 }}>QSS Core Banking</Text>
              <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>Field banking for credit unions</Text>
            </View>
          </Reveal>

          {/* Form */}
          <Reveal index={1} from={24}>
            <Animated.View style={{ transform: [{ translateX: shake }] }}>
              <View style={{ backgroundColor: colors.card, borderRadius: 28, padding: 22, ...RADIUS, boxShadow: '0 20px 48px rgba(0, 0, 0, 0.35)' }}>
                {apiMode === 'mock' ? (
                  <View style={{ backgroundColor: colors.warnBg, padding: 10, borderRadius: 12, marginBottom: 16 }}>
                    <Text style={{ color: colors.warn, fontSize: 12 }}>Demo mode. Nothing reaches the office.</Text>
                  </View>
                ) : null}

                {status === 'locked' ? (
                  <View style={{ gap: 18 }}>
                    <View style={{ alignItems: 'center', gap: 8, paddingTop: 4 }}>
                      <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="finger-print" size={36} color={colors.primary} />
                      </View>
                      <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>{welcomeName ? `Welcome back, ${welcomeName}` : 'Welcome back'}</Text>
                      <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center' }}>Use your fingerprint, face or screen lock</Text>
                    </View>
                    <Button title="Unlock" onPress={doUnlock} busy={busy} />
                  </View>
                ) : step === 'password' ? (
                  <View>
                    <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text, letterSpacing: -0.3 }}>Sign in</Text>
                    <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2, marginBottom: 18 }}>Username and password</Text>
                    <Field
                      label="Username"
                      value={staffId}
                      onChangeText={setStaffId}
                      autoCapitalize={apiMode === 'http' ? 'none' : 'characters'}
                      autoCorrect={false}
                      autoComplete="username"
                      textContentType="username"
                      returnKeyType="next"
                      blurOnSubmit={false}
                      onSubmitEditing={() => pinRef.current?.focus()}
                      trailing={staffId ? <Ionicons name="person-circle-outline" size={22} color={colors.faint} style={{ marginRight: 12 }} /> : undefined}
                    />
                    <Field
                      inputRef={pinRef}
                      label="Password"
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry={!showPin}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="current-password"
                      textContentType="password"
                      returnKeyType="go"
                      onSubmitEditing={() => void submitPassword()}
                      trailing={
                        <Pressable accessibilityRole="button" accessibilityLabel={showPin ? 'Hide password' : 'Show password'} onPress={() => setShowPin((v) => !v)} hitSlop={8} style={{ paddingHorizontal: 14, height: 52, justifyContent: 'center' }}>
                          <Ionicons name={showPin ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.muted} />
                        </Pressable>
                      }
                    />
                    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: remember }} onPress={() => setRemember((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: -4, marginBottom: 18, minHeight: 32 }}>
                      <View style={{ width: 20, height: 20, borderRadius: 6, borderWidth: remember ? 0 : 1.5, borderColor: colors.faint, backgroundColor: remember ? colors.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                        {remember ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
                      </View>
                      <Text style={{ fontSize: 13, color: colors.muted }}>Remember my username</Text>
                    </Pressable>
                    <Button title="Sign in" onPress={() => void submitPassword()} busy={busy} disabled={!canSubmit} />
                  </View>
                ) : (
                  <View>
                    <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text, letterSpacing: -0.3 }}>Check your phone</Text>
                    <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2, marginBottom: 18 }}>The 6-digit code sent by SMS</Text>
                    <Field label="Code" value={otp} onChangeText={setOtp} keyboardType="number-pad" maxLength={6} returnKeyType="go" onSubmitEditing={() => void submitOtp()} style={{ fontSize: 22, letterSpacing: 8, fontWeight: '700' }} />
                    <Button title="Verify" onPress={() => void submitOtp()} busy={busy} disabled={otp.trim().length !== 6} />
                    <View style={{ height: 10 }} />
                    <Button title="Back" variant="secondary" onPress={() => setStep('password')} disabled={busy} />
                  </View>
                )}

                {error ? (
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 16, padding: 12, borderRadius: 12, backgroundColor: colors.dangerBg }}>
                    <Ionicons name="alert-circle" size={18} color={colors.danger} style={{ marginTop: 1 }} />
                    <Text selectable style={{ flex: 1, color: colors.danger, fontSize: 13 }}>{error}</Text>
                  </View>
                ) : null}
              </View>
            </Animated.View>
          </Reveal>

          <View style={{ alignItems: 'center', gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="lock-closed" size={12} color="rgba(255,255,255,0.6)" />
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>Encrypted on this phone</Text>
            </View>
            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>QSS Mobile Banking {Constants.expoConfig?.version ? `v${Constants.expoConfig.version}` : ''}</Text>
            {__DEV__ && apiMode === 'mock' && status !== 'locked' ? (
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 4 }}>Development mock: username FO001, password Passw0rd!, code 123456.</Text>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
