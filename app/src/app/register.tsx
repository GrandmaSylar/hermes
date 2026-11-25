import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View, type ScrollViewInstance } from 'react-native';
import type { MemberConflict } from '@/data/api/contract';
import {
  DEFAULT_MEMBER_TYPES,
  EMPTY_FORM,
  ID_TYPES,
  STEPS,
  fullName,
  idNumberProblem,
  isEmail,
  isGhanaPhone,
  needsGuardian,
  parseDisplayDate,
  validateStep,
  type FormProblem,
  type MemberTypeOption,
  type RegistrationForm,
  type RegistrationItem,
} from '@/domain/registration';
import { useApp } from '@/state/AppProvider';
import { KV_MEMBER_TYPES } from '@/sync/engine';
import { registerMember } from '@/sync/register';
import { ProblemBox } from '@/ui/form';
import {
  AlertsStep,
  BeneficiariesStep,
  ContactStep,
  EmploymentStep,
  FinancialStep,
  PersonalStep,
  PreviewStep,
  type StepProps,
} from '@/ui/registration-steps';
import { Button, Card, colors } from '@/ui/theme';

/** What the live check says, in the words of the office form. */
function conflictText(c: MemberConflict): string {
  const who = c.memberName || `Member ${c.memberCode}`;
  return c.label === 'Phone' || c.label === 'Email'
    ? `${c.label} ${c.value} already in use by ${who} (Code ${c.memberCode}).`
    : `${c.label} ${c.value} already belongs to ${who} (member ${c.memberCode}).`;
}

export default function RegisterScreen() {
  const { repos, session, newId, touch, syncNow, checkMember } = useApp();
  const [form, setForm] = useState<RegistrationForm>(EMPTY_FORM);
  const [dobText, setDobText] = useState('');
  const [step, setStep] = useState(0);
  const [problems, setProblems] = useState<FormProblem[]>([]);
  const [types, setTypes] = useState<MemberTypeOption[]>(DEFAULT_MEMBER_TYPES);
  const [conflicts, setConflicts] = useState<MemberConflict[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState<RegistrationItem | null>(null);
  const scroller = useRef<ScrollViewInstance>(null);

  // The member types last fetched from the server, so the form works without a connection.
  useEffect(() => {
    if (!repos) return;
    void repos.kv.get(KV_MEMBER_TYPES).then((text) => {
      if (!text) return;
      try {
        const list = JSON.parse(text) as MemberTypeOption[];
        if (Array.isArray(list) && list.length > 0) setTypes(list);
      } catch {
        // keep the built-in list
      }
    });
  }, [repos]);

  // While online, ask whether an ID, phone or email is already held by another member, as the office form does.
  const lookupKey = JSON.stringify([form.nationalId, form.voterIdNo, form.nhisNo, form.passportNo, form.phone, form.email]);
  useEffect(() => {
    const lookup: Record<string, string> = {};
    for (const type of ID_TYPES) {
      if (form[type.field] && !idNumberProblem(type, form[type.field])) lookup[type.field] = form[type.field];
    }
    if (isGhanaPhone(form.phone)) lookup.phone = form.phone.trim();
    if (form.email && isEmail(form.email)) lookup.email = form.email.trim();
    if (Object.keys(lookup).length === 0) {
      setConflicts([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      void checkMember(lookup).then((found) => {
        if (!cancelled && found) setConflicts(found);
      });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // lookupKey stands for the six values it is built from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookupKey, checkMember]);

  const today = useMemo(() => new Date(), []);
  const stepId = STEPS[step].id;
  const guardianNeeded = needsGuardian(form, types, today);
  const branchCode = session?.branchCode ?? '';

  if (!repos || !session) return null;

  const set: StepProps['set'] = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setMessage(null);
  };
  const errorFor = (field: string) => problems.find((p) => p.field === field)?.message ?? null;
  const notices = (kinds: string[]) => conflicts.filter((c) => kinds.includes(c.label)).map(conflictText);

  const onDobText = (text: string) => {
    setDobText(text);
    set('birthDate', parseDisplayDate(text));
  };

  const goTo = (n: number) => {
    setStep(n);
    setProblems([]);
    scroller.current?.scrollTo({ y: 0, animated: false });
  };

  /** The step's own checks, plus a date that was typed but is not a real date. */
  const check = (id: (typeof STEPS)[number]['id']): FormProblem[] => {
    const found = validateStep(id, form, types, today);
    if (id === 'personal' && dobText.trim() !== '' && form.birthDate === '') {
      return [...found.filter((p) => p.field !== 'birthDate'), { field: 'birthDate', message: 'Invalid Date of Birth (use DD/MM/YYYY)' }];
    }
    return found;
  };

  const next = () => {
    const found = check(stepId);
    if (found.length > 0) {
      setProblems(found);
      scroller.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    goTo(step + 1);
  };

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      // The same checks again for every step, in case something was changed after it was passed.
      for (let i = 0; i < STEPS.length - 1; i++) {
        const found = check(STEPS[i].id);
        if (found.length > 0) {
          setStep(i);
          setProblems(found);
          scroller.current?.scrollTo({ y: 0, animated: true });
          return;
        }
      }
      // Online, make sure nobody else already holds these IDs, phone or email. Offline, the office checks.
      const lookup: Record<string, string> = {};
      for (const type of ID_TYPES) if (form[type.field]) lookup[type.field] = form[type.field];
      if (form.phone) lookup.phone = form.phone.trim();
      if (form.email) lookup.email = form.email.trim();
      const found = await checkMember(lookup);
      if (found && found.length > 0) {
        setConflicts(found);
        setStep(found.some((c) => c.label !== 'Phone' && c.label !== 'Email') ? 0 : 1);
        setMessage(`${conflictText(found[0])} Please correct it before submitting.`);
        scroller.current?.scrollTo({ y: 0, animated: true });
        return;
      }

      const result = await registerMember(repos, session, form, types, newId);
      if (!result.ok) {
        const at = STEPS.findIndex((s) => s.id === result.step);
        if (at >= 0) setStep(at);
        setProblems(result.problems);
        setMessage(result.message ?? null);
        scroller.current?.scrollTo({ y: 0, animated: true });
        return;
      }
      setSaved(result.item);
      touch();
      void syncNow();
    } finally {
      setSaving(false);
    }
  };

  const startOver = () => {
    setSaved(null);
    setForm(EMPTY_FORM);
    setDobText('');
    setStep(0);
    setProblems([]);
    setConflicts([]);
    setMessage(null);
  };

  if (saved) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Card>
          <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ok }}>Registration saved</Text>
          <Text style={{ color: colors.text, marginTop: 12, fontSize: 22, fontWeight: '700' }}>{fullName(saved)}</Text>
          <Text style={{ color: colors.muted, marginTop: 2 }}>{saved.phone}</Text>
          <Text style={{ color: colors.muted, marginTop: 12, fontSize: 12 }}>
            Saved on this phone and sent to the office automatically. The member gets a member number and can transact once the office approves, so do not collect cash for them yet.
          </Text>
          <Text style={{ color: colors.muted, marginTop: 8, fontSize: 12 }}>Ref {saved.localRegistrationId.slice(0, 8).toUpperCase()}</Text>
        </Card>
        <Button title="Done" onPress={() => router.dismissTo('/(tabs)')} />
        <Button title="Register another member" variant="secondary" onPress={startOver} />
      </ScrollView>
    );
  }

  const stepProps: StepProps = { form, set, errorFor };
  const last = step === STEPS.length - 1;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, backgroundColor: colors.bg }}>
        <Text style={{ color: colors.muted, fontSize: 12 }}>
          Step {step + 1} of {STEPS.length}
        </Text>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 2 }}>{STEPS[step].label}</Text>
        <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: 8 }}>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.primary, width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </View>
      </View>
      <ScrollView ref={scroller} contentContainerStyle={{ padding: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <ProblemBox problems={problems} />
        {message ? <Text style={{ color: colors.danger, marginBottom: 12 }}>{message}</Text> : null}

        {stepId === 'personal' ? (
          <PersonalStep {...stepProps} types={types} guardianNeeded={guardianNeeded} branchCode={branchCode} dobText={dobText} onDobText={onDobText} notices={notices(['Ghana Card', 'Voter ID', 'NHIS card', 'Passport'])} />
        ) : null}
        {stepId === 'contact' ? <ContactStep {...stepProps} notices={notices(['Phone', 'Email'])} /> : null}
        {stepId === 'employment' ? <EmploymentStep {...stepProps} /> : null}
        {stepId === 'financial' ? <FinancialStep {...stepProps} /> : null}
        {stepId === 'beneficiaries' ? <BeneficiariesStep {...stepProps} /> : null}
        {stepId === 'alerts' ? <AlertsStep {...stepProps} /> : null}
        {stepId === 'preview' ? <PreviewStep form={form} types={types} branchCode={branchCode} guardianNeeded={guardianNeeded} goTo={goTo} /> : null}

        <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
          {step > 0 ? (
            <View style={{ flex: 1 }}>
              <Button title="Back" variant="secondary" onPress={() => goTo(step - 1)} />
            </View>
          ) : null}
          <View style={{ flex: 1 }}>
            {last ? <Button title="Submit registration" onPress={() => void submit()} busy={saving} /> : <Button title="Next" onPress={next} />}
          </View>
        </View>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 12 }}>
          Saved on this phone first, then sent to the office automatically. Nothing is lost if the signal drops.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
