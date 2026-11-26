import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, Text, View } from 'react-native';
import { captureKycFile, type CaptureSource } from '@/data/kyc-capture';
import { citiesForRegion, REGIONS } from '@/domain/ghana-locations';
import {
  AUTHORIZATION_PREFERENCES,
  BENEFICIARY_RELATIONSHIPS,
  EMPLOYMENT_TYPES,
  EMPTY_BENEFICIARY,
  ID_TYPES,
  KYC_SLOTS,
  MARITAL_STATUSES,
  MISSING_ID_MESSAGE,
  SEXES,
  SOURCES_OF_FUNDS,
  TITLES,
  TRANSACTION_VOLUMES,
  beneficiaryTotal,
  formatDisplayDate,
  parseDisplayDate,
  isFullName,
  isGhanaPhone,
  memberTypeHelp,
  normaliseIdNumber,
  remainingPercentage,
  type BeneficiaryForm,
  type FormProblem,
  type KycKind,
  type KycSlot,
  type MemberTypeOption,
  type RegistrationForm,
} from '@/domain/registration';
import { Button, colors } from '@/ui/theme';
import { ChoiceField, Disclosure, Group, NoticeBox, Pair, SelectField, TextField, ToggleLine, toOptions } from '@/ui/form';

export interface StepProps {
  form: RegistrationForm;
  set: <K extends keyof RegistrationForm>(key: K, value: RegistrationForm[K]) => void;
  /** The message for one field, when the step was checked and it is wrong. */
  errorFor: (field: string) => string | null;
}

const filled = (...values: (string | boolean | undefined)[]) => values.some((v) => v === true || (typeof v === 'string' && v.trim() !== ''));

/** The phone's own calendar, as a button beside the typed date. */
function CalendarButton({ text, onPick }: { text: string; onPick: (display: string) => void }) {
  const [iosOpen, setIosOpen] = useState(false);
  const current = () => {
    const iso = parseDisplayDate(text);
    const d = iso ? new Date(`${iso}T12:00:00`) : new Date(1990, 0, 1, 12);
    return Number.isNaN(d.getTime()) ? new Date(1990, 0, 1, 12) : d;
  };
  const chosen = (event: DateTimePickerEvent, date?: Date) => {
    if (event.type !== 'set' || !date) return;
    const pad = (n: number) => String(n).padStart(2, '0');
    onPick(`${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`);
  };
  const open = () => {
    if (Platform.OS === 'android') DateTimePickerAndroid.open({ value: current(), mode: 'date', maximumDate: new Date(), onChange: chosen });
    else setIosOpen((v) => !v);
  };
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel="Pick date of birth from calendar" onPress={open} style={({ pressed }) => ({ width: 52, height: 52, borderRadius: 14, borderCurve: 'continuous', backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
        <Ionicons name="calendar-outline" size={22} color={colors.primary} />
      </Pressable>
      {Platform.OS === 'ios' && iosOpen ? <DateTimePicker value={current()} mode="date" display="spinner" maximumDate={new Date()} onChange={chosen} /> : null}
    </View>
  );
}

// ---- documents (KYC) -----------------------------------------------------------

const kb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function IconAction({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => ({ flex: 1, height: 40, borderRadius: 12, borderCurve: 'continuous', backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
      <Ionicons name={icon} size={20} color={colors.primary} />
    </Pressable>
  );
}

/** One picture to attach: a tile showing what is there, with camera, photo and (where allowed) PDF buttons. */
function DocumentTile({ slot, form, set, error }: { slot: KycSlot; form: RegistrationForm; set: StepProps['set']; error: string | null }) {
  const file = form.documents[slot.kind];
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const pick = async (source: CaptureSource) => {
    setBusy(true);
    setProblem(null);
    const result = await captureKycFile(slot.kind, source);
    setBusy(false);
    if ('file' in result) set('documents', { ...form.documents, [slot.kind]: result.file });
    else if ('error' in result) setProblem(result.error);
  };
  const remove = () => {
    const next = { ...form.documents };
    delete next[slot.kind as KycKind];
    set('documents', next);
  };
  const shown = problem ?? error;

  return (
    <View style={{ flexBasis: '47%', flexGrow: 1, backgroundColor: colors.card, borderRadius: 18, borderCurve: 'continuous', padding: 10, gap: 8, borderWidth: 1.5, borderColor: shown ? colors.danger : file ? colors.ok : 'transparent', boxShadow: '0 1px 2px rgba(16, 24, 40, 0.06), 0 2px 8px rgba(16, 24, 40, 0.04)' }}>
      <View style={{ height: 88, borderRadius: 12, borderCurve: 'continuous', backgroundColor: '#EEF1F6', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {busy ? (
          <ActivityIndicator color={colors.primary} />
        ) : file ? (
          file.mimeType === 'application/pdf' ? (
            <Ionicons name="document-text" size={34} color={colors.muted} />
          ) : (
            <Image source={{ uri: file.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          )
        ) : (
          <Ionicons name="camera-outline" size={30} color="#9AA3B2" />
        )}
        {file && !busy ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${slot.label}`} onPress={remove} hitSlop={8} style={{ position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(16,24,40,0.65)', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="close" size={14} color="#FFFFFF" />
          </Pressable>
        ) : null}
      </View>
      <View>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>{slot.label}</Text>
        <Text numberOfLines={1} style={{ fontSize: 11, color: file ? colors.ok : colors.muted }}>{file ? `${kb(file.size)} · ready` : 'Optional'}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <IconAction icon="camera" label={`Take photo for ${slot.label}`} onPress={() => void pick('camera')} />
        <IconAction icon="image" label={`Choose photo for ${slot.label}`} onPress={() => void pick('library')} />
        {slot.pdf ? <IconAction icon="document" label={`Choose PDF for ${slot.label}`} onPress={() => void pick('file')} /> : null}
      </View>
      {shown ? <Text style={{ color: colors.danger, fontSize: 11 }}>{shown}</Text> : null}
    </View>
  );
}

export function DocumentsStep({ form, set, errorFor }: StepProps) {
  return (
    <View style={{ gap: 14 }}>
      <Group title="Authorization">
        <ChoiceField label="How will the member authorise withdrawals?" value={form.authorizationPreference} options={AUTHORIZATION_PREFERENCES} onChange={(v) => set('authorizationPreference', v)} />
      </Group>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {KYC_SLOTS.map((slot) => (
          <DocumentTile key={slot.kind} slot={slot} form={form} set={set} error={errorFor(`documents.${slot.kind}`)} />
        ))}
      </View>
      <Text style={{ fontSize: 12, color: colors.muted, textAlign: 'center' }}>Pictures are optional, and are deleted from this phone once sent.</Text>
    </View>
  );
}

// ---- 1. personal information -------------------------------------------------

export function PersonalStep(
  props: StepProps & {
    types: MemberTypeOption[];
    guardianNeeded: boolean;
    branchCode: string;
    dobText: string;
    onDobText: (text: string) => void;
    /** Live answers about IDs and phones already held by another member. */
    notices: string[];
  },
) {
  const { form, set, errorFor, types } = props;
  const selected = types.find((t) => t.code === form.memberType);
  const setGuardian = (key: keyof RegistrationForm['guardian'], value: string) => set('guardian', { ...form.guardian, [key]: value });
  const idsError = errorFor('ids');
  const ghana = ID_TYPES[0];
  const otherIds = ID_TYPES.slice(1);

  return (
    <View style={{ gap: 14 }}>
      <Group>
        <SelectField
          label="Member type"
          required
          value={form.memberType}
          options={types.map((t) => ({ value: t.code, label: t.label }))}
          onChange={(v) => set('memberType', v)}
          error={errorFor('memberType')}
          help={memberTypeHelp(selected)}
          placeholder="Choose"
        />
        {props.guardianNeeded ? (
          <NoticeBox tone="warn">{selected?.guardianRequired ? 'A parent or guardian operates this account. Add their details below.' : 'Under 18: add a guardian below.'}</NoticeBox>
        ) : null}
      </Group>

      <Group title="Name">
        <Pair>
          <SelectField label="Title" value={form.title} options={toOptions(TITLES)} onChange={(v) => set('title', v)} placeholder="Title" />
          <SelectField label="Marital status" value={form.maritalStatus} options={toOptions(MARITAL_STATUSES)} onChange={(v) => set('maritalStatus', v)} placeholder="Status" />
        </Pair>
        <Pair>
          <TextField label="First name" required value={form.firstName} onChange={(v) => set('firstName', v)} error={errorFor('firstName')} autoCapitalize="words" maxLength={50} />
          <TextField label="Last name" required value={form.lastName} onChange={(v) => set('lastName', v)} error={errorFor('lastName')} autoCapitalize="words" maxLength={50} />
        </Pair>
        <Disclosure title="Add middle name" open={filled(form.middleName) || !!errorFor('middleName')}>
          <TextField label="Middle name" value={form.middleName} onChange={(v) => set('middleName', v)} error={errorFor('middleName')} autoCapitalize="words" maxLength={50} />
        </Disclosure>
      </Group>

      <Group title="About">
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginBottom: errorFor('birthDate') ? 0 : 14 }}>
          <View style={{ flex: 1 }}>
            <TextField label="Date of birth" required value={props.dobText} onChange={props.onDobText} error={errorFor('birthDate')} keyboardType="numbers-and-punctuation" placeholder="DD/MM/YYYY" maxLength={10} flush />
          </View>
          <CalendarButton text={props.dobText} onPick={props.onDobText} />
        </View>
        {errorFor('birthDate') ? <Text style={{ color: colors.danger, fontSize: 12, marginBottom: 14, marginTop: 6 }}>{errorFor('birthDate')}</Text> : null}
        <ChoiceField label="Gender" required value={form.sex} options={toOptions(SEXES)} onChange={(v) => set('sex', v)} error={errorFor('sex')} />
      </Group>

      <Group title="ID">
        <TextField
          label={ghana.label}
          value={form[ghana.field]}
          onChange={(raw) => set(ghana.field, normaliseIdNumber(ghana.key, raw))}
          error={errorFor(ghana.field)}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={15}
          placeholder={ghana.hint}
        />
        <Disclosure title="No Ghana Card? Use another ID" open={otherIds.some((t) => filled(form[t.field]) || !!errorFor(t.field)) || !!idsError}>
          {otherIds.map((type) => (
            <TextField
              key={type.key}
              label={type.label}
              value={form[type.field]}
              onChange={(raw) => set(type.field, normaliseIdNumber(type.key, raw))}
              error={errorFor(type.field)}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={20}
              placeholder={type.hint}
            />
          ))}
        </Disclosure>
        {idsError ? <Text style={{ color: colors.danger, fontSize: 12, marginBottom: 12 }}>{idsError || MISSING_ID_MESSAGE}</Text> : null}
        {props.notices.map((n) => (
          <NoticeBox key={n} tone="warn">{n}</NoticeBox>
        ))}
      </Group>

      <Disclosure title="More details" open={filled(form.registrationNo, form.staffNo)}>
        <Group>
          <TextField label="Registration no." value={form.registrationNo} onChange={(v) => set('registrationNo', v)} maxLength={30} />
          <TextField label="Staff no." value={form.staffNo} onChange={(v) => set('staffNo', v)} maxLength={20} />
        </Group>
      </Disclosure>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }}>
        <Ionicons name="business-outline" size={16} color={colors.muted} />
        <Text style={{ fontSize: 13, color: colors.muted }}>Registered to branch {props.branchCode}</Text>
      </View>

      {props.guardianNeeded ? (
        <Group title="Guardian">
          <TextField label="Full name" required value={form.guardian.name} onChange={(v) => setGuardian('name', v)} error={errorFor('guardian.name')} autoCapitalize="words" maxLength={200} />
          <TextField label="ID number" required value={form.guardian.nationalId} onChange={(v) => setGuardian('nationalId', v.toUpperCase())} error={errorFor('guardian.nationalId')} autoCapitalize="characters" autoCorrect={false} maxLength={30} />
          <TextField label="Phone" required value={form.guardian.phone} onChange={(v) => setGuardian('phone', v)} error={errorFor('guardian.phone')} keyboardType="phone-pad" maxLength={20} />
          <Disclosure title="More guardian details" open={filled(form.guardian.relationship, form.guardian.address, form.guardian.employer)}>
            <TextField label="Relationship" value={form.guardian.relationship} onChange={(v) => setGuardian('relationship', v)} maxLength={50} placeholder="Parent, uncle, aunt…" />
            <TextField label="Address" value={form.guardian.address} onChange={(v) => setGuardian('address', v)} multiline maxLength={200} />
            <TextField label="Employer" value={form.guardian.employer} onChange={(v) => setGuardian('employer', v)} maxLength={200} />
          </Disclosure>
        </Group>
      ) : null}
    </View>
  );
}

// ---- 2. contact information --------------------------------------------------

export function ContactStep(props: StepProps & { notices: string[] }) {
  const { form, set, errorFor } = props;
  const suggestions = useMemo(() => {
    const typed = form.city.trim().toLowerCase();
    const all = citiesForRegion(form.region);
    if (!form.region || all.length === 0) return [];
    const matching = typed ? all.filter((c) => c.toLowerCase().includes(typed)) : all;
    // Once the typed name is exactly one of them there is nothing left to suggest.
    return matching.length === 1 && matching[0].toLowerCase() === typed ? [] : matching.slice(0, 8);
  }, [form.region, form.city]);

  return (
    <View style={{ gap: 14 }}>
      <Group title="Reach">
        <TextField label="Phone" required value={form.phone} onChange={(v) => set('phone', v)} error={errorFor('phone')} keyboardType="phone-pad" maxLength={16} placeholder="0244 000 000" />
        <TextField label="Email" value={form.email} onChange={(v) => set('email', v)} error={errorFor('email')} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} maxLength={150} placeholder="Optional" />
        {props.notices.map((n) => (
          <NoticeBox key={n} tone="warn">{n}</NoticeBox>
        ))}
      </Group>

      <Group title="Home">
        <TextField label="Residential address" required value={form.residentialAddress} onChange={(v) => set('residentialAddress', v)} error={errorFor('residentialAddress')} multiline maxLength={200} />
        <SelectField
          label="Region"
          required
          value={form.region}
          options={toOptions(REGIONS)}
          onChange={(v) => {
            set('region', v);
            // The city belonged to the old region, so start again.
            if (v !== form.region) set('city', '');
          }}
          error={errorFor('region')}
          placeholder="Choose"
        />
        <TextField label="City / town" required value={form.city} onChange={(v) => set('city', v)} error={errorFor('city')} autoCapitalize="words" maxLength={100} />
        {suggestions.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: -6, marginBottom: 14 }}>
            {suggestions.map((c) => (
              <Pressable key={c} onPress={() => set('city', c)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: colors.primarySoft }}>
                <Text style={{ color: colors.primaryDeep, fontSize: 13, fontWeight: '600' }}>{c}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <TextField label="Landmark" value={form.landmark} onChange={(v) => set('landmark', v)} maxLength={200} placeholder="Optional" />
      </Group>

      <Disclosure
        title="More contact and address details"
        open={filled(form.contactValue, form.mobileAlert, form.preferredContactTime, form.addressLine1, form.addressLine2, form.addressLine3, form.gpsCoordinates, form.allowMarketing) || !!errorFor('mobileAlert')}
      >
        <Group>
          <TextField label="Alert number" value={form.mobileAlert} onChange={(v) => set('mobileAlert', v)} error={errorFor('mobileAlert')} keyboardType="phone-pad" maxLength={16} placeholder="Defaults to the phone" />
          <TextField label="Primary contact" value={form.contactValue} onChange={(v) => set('contactValue', v)} maxLength={200} placeholder="Defaults to phone and email" />
          <TextField label="Best time to call" value={form.preferredContactTime} onChange={(v) => set('preferredContactTime', v)} maxLength={50} />
          <TextField label="Address line 1" value={form.addressLine1} onChange={(v) => set('addressLine1', v)} maxLength={200} />
          <TextField label="Address line 2" value={form.addressLine2} onChange={(v) => set('addressLine2', v)} maxLength={200} />
          <TextField label="Address line 3" value={form.addressLine3} onChange={(v) => set('addressLine3', v)} maxLength={200} />
          <TextField label="GPS coordinates" value={form.gpsCoordinates} onChange={(v) => set('gpsCoordinates', v)} maxLength={50} />
          <ToggleLine label="Marketing messages" value={form.allowMarketing} onChange={(v) => set('allowMarketing', v)} last />
        </Group>
      </Disclosure>
    </View>
  );
}

// ---- 3. employment -------------------------------------------------------------

export function EmploymentStep({ form, set, errorFor }: StepProps) {
  return (
    <View style={{ gap: 14 }}>
      <Group>
        <TextField label="Employer" value={form.employerName} onChange={(v) => set('employerName', v)} maxLength={50} />
        <TextField label="Job title" value={form.jobTitle} onChange={(v) => set('jobTitle', v)} maxLength={100} />
        <Pair>
          <SelectField label="Type" value={form.employmentType} options={toOptions(EMPLOYMENT_TYPES)} onChange={(v) => set('employmentType', v)} placeholder="Choose" />
          <TextField label="Years" value={form.yearsWithEmployer} onChange={(v) => set('yearsWithEmployer', v)} error={errorFor('yearsWithEmployer')} keyboardType="decimal-pad" maxLength={6} />
        </Pair>
        <Disclosure title="Employer address, contact and income" open={filled(form.employerAddress, form.employerContact, form.incomeSource)}>
          <TextField label="Employer address" value={form.employerAddress} onChange={(v) => set('employerAddress', v)} maxLength={80} />
          <TextField label="Employer contact" value={form.employerContact} onChange={(v) => set('employerContact', v)} maxLength={50} />
          <TextField label="Income source" value={form.incomeSource} onChange={(v) => set('incomeSource', v)} maxLength={200} />
        </Disclosure>
      </Group>
      {form.employerName.trim() === '' && filled(form.jobTitle, form.employmentType, form.employerAddress, form.employerContact, form.incomeSource) ? (
        <NoticeBox tone="info">These are only saved when an employer is given.</NoticeBox>
      ) : null}
    </View>
  );
}

// ---- 4. financial ----------------------------------------------------------------

export function FinancialStep({ form, set }: StepProps) {
  return (
    <View style={{ gap: 14 }}>
      <Group title="Bank">
        <Pair>
          <TextField label="Bank" value={form.customerBank} onChange={(v) => set('customerBank', v)} maxLength={100} />
          <TextField label="Branch" value={form.customerBranch} onChange={(v) => set('customerBranch', v)} maxLength={100} />
        </Pair>
        <TextField label="Account number" value={form.bankAccountNo} onChange={(v) => set('bankAccountNo', v)} keyboardType="number-pad" maxLength={50} />
      </Group>
      <Group title="Funds">
        <SelectField label="Source of funds" value={form.sourceOfFunds} options={SOURCES_OF_FUNDS} onChange={(v) => set('sourceOfFunds', v)} placeholder="Choose" />
        <SelectField label="Expected monthly volume" value={form.expectedTransactionVolume} options={TRANSACTION_VOLUMES} onChange={(v) => set('expectedTransactionVolume', v)} placeholder="Choose" />
        <ToggleLine label="Politically exposed person" value={form.politicallyExposed} onChange={(v) => set('politicallyExposed', v)} last />
      </Group>
    </View>
  );
}

// ---- 5. beneficiaries -----------------------------------------------------------

export function BeneficiariesStep({ form, set, errorFor }: StepProps) {
  const [draft, setDraft] = useState<BeneficiaryForm>(EMPTY_BENEFICIARY);
  const [draftError, setDraftError] = useState<string | null>(null);
  const total = beneficiaryTotal(form.beneficiaries);
  const left = remainingPercentage(form.beneficiaries);
  const patch = <K extends keyof BeneficiaryForm>(key: K, value: BeneficiaryForm[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const add = () => {
    const percentage = Number.parseFloat(draft.percentage) || 0;
    if (!draft.name.trim() || !draft.relationship || percentage <= 0) {
      setDraftError('Enter the name, relationship and a percentage above zero.');
      return;
    }
    if (!isFullName(draft.name)) {
      setDraftError('Full name must include at least two names.');
      return;
    }
    if (percentage > left) {
      setDraftError(`Only ${left}% is left to allocate.`);
      return;
    }
    if (draft.isMinor && (!draft.guardianName.trim() || !isGhanaPhone(draft.guardianPhone))) {
      setDraftError('A minor needs a guardian name and a valid guardian phone.');
      return;
    }
    set('beneficiaries', [...form.beneficiaries, draft]);
    setDraft(EMPTY_BENEFICIARY);
    setDraftError(null);
  };

  return (
    <View style={{ gap: 14 }}>
      {/* Allocation meter */}
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: total === 100 ? colors.ok : colors.text }}>{total}% allocated</Text>
          <Text style={{ fontSize: 13, color: colors.muted }}>{left}% left</Text>
        </View>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: '#E3E7EE', overflow: 'hidden' }}>
          <View style={{ height: 8, width: `${Math.min(100, total)}%`, backgroundColor: total === 100 ? colors.ok : colors.primary, borderRadius: 4 }} />
        </View>
        {errorFor('beneficiaries') ? <Text style={{ color: colors.danger, fontSize: 12 }}>{errorFor('beneficiaries')}</Text> : null}
      </View>

      {form.beneficiaries.map((b, i) => (
        <View key={`${b.name}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, borderCurve: 'continuous', backgroundColor: colors.card, borderWidth: 1.5, borderColor: errorFor(`beneficiaries.${i}.name`) || errorFor(`beneficiaries.${i}.guardianName`) ? colors.danger : 'transparent', boxShadow: '0 1px 2px rgba(16, 24, 40, 0.06)' }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: colors.primaryDeep, fontWeight: '700' }}>{b.percentage}%</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>{b.name}</Text>
            <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>{b.relationship}{b.isMinor ? ` · minor, guardian ${b.guardianName}` : ''}</Text>
          </View>
          <Pressable accessibilityLabel={`Edit ${b.name}`} hitSlop={8} onPress={() => { setDraft(b); set('beneficiaries', form.beneficiaries.filter((_, j) => j !== i)); }}>
            <Ionicons name="create-outline" size={20} color={colors.primary} />
          </Pressable>
          <Pressable accessibilityLabel={`Remove ${b.name}`} hitSlop={8} onPress={() => set('beneficiaries', form.beneficiaries.filter((_, j) => j !== i))}>
            <Ionicons name="trash-outline" size={20} color={colors.danger} />
          </Pressable>
        </View>
      ))}

      <Group title={form.beneficiaries.length === 0 ? 'Add a beneficiary' : 'Add another'}>
        <TextField label="Full name" value={draft.name} onChange={(v) => patch('name', v)} autoCapitalize="words" maxLength={30} />
        <Pair>
          <SelectField label="Relationship" value={draft.relationship} options={toOptions(BENEFICIARY_RELATIONSHIPS)} onChange={(v) => patch('relationship', v)} placeholder="Choose" />
          <TextField label="Share %" value={draft.percentage} onChange={(v) => patch('percentage', v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" maxLength={7} placeholder={left > 0 ? `up to ${left}` : '0'} />
        </Pair>
        <Disclosure title="Phone, email, address" open={filled(draft.phone, draft.email, draft.address)}>
          <TextField label="Phone" value={draft.phone} onChange={(v) => patch('phone', v)} keyboardType="phone-pad" maxLength={20} />
          <TextField label="Email" value={draft.email} onChange={(v) => patch('email', v)} keyboardType="email-address" autoCapitalize="none" maxLength={100} />
          <TextField label="Address" value={draft.address} onChange={(v) => patch('address', v)} maxLength={30} />
        </Disclosure>
        <ToggleLine label="Is a minor" value={draft.isMinor} onChange={(v) => patch('isMinor', v)} last />
        {draft.isMinor ? (
          <View style={{ marginTop: 8 }}>
            <TextField label="Guardian name" value={draft.guardianName} onChange={(v) => patch('guardianName', v)} autoCapitalize="words" maxLength={200} />
            <TextField label="Guardian phone" value={draft.guardianPhone} onChange={(v) => patch('guardianPhone', v)} keyboardType="phone-pad" maxLength={20} />
          </View>
        ) : null}
        {draftError ? <Text style={{ color: colors.danger, fontSize: 13, marginBottom: 12 }}>{draftError}</Text> : null}
        <View style={{ marginBottom: 12 }}>
          <Button title="Add beneficiary" variant="secondary" onPress={add} />
        </View>
      </Group>
    </View>
  );
}

// ---- 6. alert preferences ---------------------------------------------------------

export function AlertsStep({ form, set }: StepProps) {
  const a = form.alerts;
  const change = (key: keyof typeof a) => (v: boolean) => set('alerts', { ...a, [key]: v });
  return (
    <Group>
      <ToggleLine label="SMS alerts" value={a.sms} onChange={change('sms')} />
      <ToggleLine label="Email alerts" value={a.email} onChange={change('email')} />
      <ToggleLine label="Transactions" value={a.transaction} onChange={change('transaction')} />
      <ToggleLine label="Loans" value={a.loan} onChange={change('loan')} />
      <ToggleLine label="Maturity" value={a.maturity} onChange={change('maturity')} />
      <ToggleLine label="Offers and news" value={a.promotional} onChange={change('promotional')} last />
    </Group>
  );
}

// ---- 7. preview ------------------------------------------------------------------

/** A line in the summary. Nothing is shown for a value that was left empty. */
function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 5, gap: 12 }}>
      <Text style={{ width: 104, color: colors.muted, fontSize: 13 }}>{label}</Text>
      <Text style={{ flex: 1, color: colors.text, fontSize: 14 }}>{value}</Text>
    </View>
  );
}

function Section({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <Group>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{title}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${title}`} onPress={onEdit} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="create-outline" size={16} color={colors.primary} />
          <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 13 }}>Edit</Text>
        </Pressable>
      </View>
      <View style={{ paddingBottom: 10 }}>{children}</View>
    </Group>
  );
}

export function PreviewStep(props: { form: RegistrationForm; types: MemberTypeOption[]; branchCode: string; guardianNeeded: boolean; goTo: (step: number) => void }) {
  const { form: f } = props;
  const type = props.types.find((t) => t.code === f.memberType);
  const yes = (v: boolean) => (v ? 'Yes' : 'No');
  const attached = KYC_SLOTS.filter((s) => f.documents[s.kind]).map((s) => s.label);
  return (
    <View style={{ gap: 12 }}>
      <Section title="Personal" onEdit={() => props.goTo(0)}>
        <Row label="Type" value={type?.label ?? f.memberType} />
        <Row label="Name" value={[f.title, f.firstName, f.middleName, f.lastName].filter(Boolean).join(' ')} />
        <Row label="Born" value={formatDisplayDate(f.birthDate)} />
        <Row label="Gender" value={f.sex} />
        <Row label="Marital" value={f.maritalStatus} />
        {ID_TYPES.map((t) => <Row key={t.key} label={t.label.replace(' Number', '')} value={f[t.field]} />)}
        <Row label="Registration no." value={f.registrationNo} />
        <Row label="Staff no." value={f.staffNo} />
        <Row label="Branch" value={props.branchCode} />
        {props.guardianNeeded ? (
          <>
            <Row label="Guardian" value={f.guardian.name} />
            <Row label="Guardian ID" value={f.guardian.nationalId} />
            <Row label="Guardian phone" value={f.guardian.phone} />
          </>
        ) : null}
      </Section>
      <Section title="Contact" onEdit={() => props.goTo(1)}>
        <Row label="Phone" value={f.phone} />
        <Row label="Email" value={f.email} />
        <Row label="Alert number" value={f.mobileAlert} />
        <Row label="Address" value={f.residentialAddress} />
        <Row label="Region" value={f.region} />
        <Row label="City" value={f.city} />
        <Row label="Landmark" value={f.landmark} />
      </Section>
      {filled(f.employerName, f.jobTitle, f.employmentType, f.yearsWithEmployer) ? (
        <Section title="Employment" onEdit={() => props.goTo(2)}>
          <Row label="Employer" value={f.employerName} />
          <Row label="Job title" value={f.jobTitle} />
          <Row label="Type" value={f.employmentType} />
          <Row label="Years" value={f.yearsWithEmployer} />
        </Section>
      ) : null}
      <Section title="Financial" onEdit={() => props.goTo(3)}>
        <Row label="Bank" value={[f.customerBank, f.customerBranch].filter(Boolean).join(', ')} />
        <Row label="Account no." value={f.bankAccountNo} />
        <Row label="Source of funds" value={f.sourceOfFunds} />
        <Row label="Monthly volume" value={f.expectedTransactionVolume} />
        <Row label="PEP" value={yes(f.politicallyExposed)} />
      </Section>
      <Section title="Documents" onEdit={() => props.goTo(4)}>
        <Row label="Authorization" value={AUTHORIZATION_PREFERENCES.find((p) => p.value === f.authorizationPreference)?.label ?? ''} />
        <Row label="Attached" value={attached.length > 0 ? attached.join(', ') : 'None'} />
      </Section>
      <Section title="Beneficiaries" onEdit={() => props.goTo(5)}>
        {f.beneficiaries.map((b, i) => (
          <Row key={i} label={`${b.percentage}%`} value={`${b.name} (${b.relationship})`} />
        ))}
        <Row label="Total" value={`${beneficiaryTotal(f.beneficiaries)}%`} />
      </Section>
      <Section title="Alerts" onEdit={() => props.goTo(6)}>
        <Row label="SMS / Email" value={`${yes(f.alerts.sms)} / ${yes(f.alerts.email)}`} />
        <Row label="Other" value={[f.alerts.transaction && 'transactions', f.alerts.loan && 'loans', f.alerts.maturity && 'maturity', f.alerts.promotional && 'offers'].filter(Boolean).join(', ') || 'None'} />
      </Section>
      <Text style={{ fontSize: 12, color: colors.muted, textAlign: 'center' }}>The member is saved as pending until the office approves.</Text>
    </View>
  );
}

export type { FormProblem };
