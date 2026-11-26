import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
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
import { Button, Card, colors } from '@/ui/theme';
import { ChoiceField, NoticeBox, SectionTitle, SelectField, SwitchRow, TextField, toOptions } from '@/ui/form';

export interface StepProps {
  form: RegistrationForm;
  set: <K extends keyof RegistrationForm>(key: K, value: RegistrationForm[K]) => void;
  /** The message for one field, when the step was checked and it is wrong. */
  errorFor: (field: string) => string | null;
}

// ---- documents (KYC) -----------------------------------------------------------

const kb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

const pill = { minHeight: 44, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' as const, backgroundColor: colors.card };
const pillText = { color: colors.primary, fontWeight: '600' as const };

function DocumentSlot({ slot, form, set, error }: { slot: KycSlot; form: RegistrationForm; set: StepProps['set']; error: string | null }) {
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
    <Card>
      <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{slot.label}</Text>
      <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{slot.help}</Text>
      {file ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 }}>
          {file.mimeType === 'application/pdf' ? (
            <View style={{ width: 64, height: 64, borderRadius: 8, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontWeight: '700', color: colors.muted }}>PDF</Text>
            </View>
          ) : (
            <Image source={{ uri: file.uri }} style={{ width: 64, height: 64, borderRadius: 8, backgroundColor: colors.border }} />
          )}
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: colors.text }}>{file.name}</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>{kb(file.size)} - ready to send</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${slot.label}`} onPress={remove} style={{ padding: 8 }}>
            <Text style={{ color: colors.danger, fontWeight: '600' }}>Remove</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        {busy ? (
          <ActivityIndicator />
        ) : (
          <>
            <Pressable accessibilityRole="button" onPress={() => void pick('camera')} style={pill}>
              <Text style={pillText}>{file ? 'Retake' : 'Take photo'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => void pick('library')} style={pill}>
              <Text style={pillText}>Choose photo</Text>
            </Pressable>
            {slot.pdf ? (
              <Pressable accessibilityRole="button" onPress={() => void pick('file')} style={pill}>
                <Text style={pillText}>Choose PDF</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </View>
      {shown ? <Text style={{ color: colors.danger, fontSize: 13, marginTop: 8 }}>{shown}</Text> : null}
    </Card>
  );
}

export function DocumentsStep({ form, set, errorFor }: StepProps) {
  return (
    <View style={{ gap: 12 }}>
      <NoticeBox tone="info">
        Pictures are optional but speed up approval. They are kept on this phone until the office has them, then deleted from it.
      </NoticeBox>
      <Card>
        <ChoiceField
          label="Preferred authorization"
          value={form.authorizationPreference}
          options={AUTHORIZATION_PREFERENCES}
          onChange={(v) => set('authorizationPreference', v)}
        />
        <Text style={{ fontSize: 12, color: colors.muted, marginTop: -6 }}>How the member will authorise withdrawals.</Text>
      </Card>
      {KYC_SLOTS.map((slot) => (
        <DocumentSlot key={slot.kind} slot={slot} form={form} set={set} error={errorFor(`documents.${slot.kind}`)} />
      ))}
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

  return (
    <View>
      <SelectField
        label="Member Type"
        required
        value={form.memberType}
        options={types.map((t) => ({ value: t.code, label: t.label }))}
        onChange={(v) => set('memberType', v)}
        error={errorFor('memberType')}
        help={memberTypeHelp(selected)}
        placeholder="Choose the member type first"
      />

      {props.guardianNeeded ? (
        <NoticeBox tone="warn">
          {selected?.guardianRequired
            ? `${selected.label}: guardian details required. This account is operated by a parent or guardian.`
            : 'Minor detected (under 18). A guardian must be added to complete the registration.'}
        </NoticeBox>
      ) : null}

      <SelectField label="Title" value={form.title} options={toOptions(TITLES)} onChange={(v) => set('title', v)} help="Select appropriate title" />
      <TextField label="First Name" required value={form.firstName} onChange={(v) => set('firstName', v)} error={errorFor('firstName')} autoCapitalize="words" maxLength={50} help="Legal first name" />
      <TextField label="Middle Name" value={form.middleName} onChange={(v) => set('middleName', v)} error={errorFor('middleName')} autoCapitalize="words" maxLength={50} help="Optional middle name" />
      <TextField label="Last Name" required value={form.lastName} onChange={(v) => set('lastName', v)} error={errorFor('lastName')} autoCapitalize="words" maxLength={50} help="Legal last name" />
      <TextField
        label="Date of Birth"
        required
        value={props.dobText}
        onChange={props.onDobText}
        error={errorFor('birthDate')}
        keyboardType="numbers-and-punctuation"
        placeholder="DD/MM/YYYY"
        maxLength={10}
        help={props.guardianNeeded ? 'Minor (under 18): guardian information required' : 'Enter date of birth. Minors (under 18) require guardian information.'}
      />
      <ChoiceField label="Gender" required value={form.sex} options={toOptions(SEXES)} onChange={(v) => set('sex', v)} error={errorFor('sex')} />
      <SelectField label="Marital Status" value={form.maritalStatus} options={toOptions(MARITAL_STATUSES)} onChange={(v) => set('maritalStatus', v)} />
      <TextField label="Registration Number" value={form.registrationNo} onChange={(v) => set('registrationNo', v)} maxLength={30} help="Optional registration number" />

      <NoticeBox tone="info">{MISSING_ID_MESSAGE} Members without a Ghana Card can register with any of the others.</NoticeBox>
      {idsError ? <Text style={{ color: colors.danger, fontSize: 13, marginTop: -8, marginBottom: 12 }}>{idsError}</Text> : null}
      {ID_TYPES.map((type) => (
        <TextField
          key={type.key}
          label={type.label}
          value={form[type.field]}
          onChange={(raw) => set(type.field, normaliseIdNumber(type.key, raw))}
          error={errorFor(type.field)}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={type.key === 'GHANA_CARD' ? 15 : 20}
          help={type.hint}
        />
      ))}
      {props.notices.map((n) => (
        <NoticeBox key={n} tone="warn">
          {n}
        </NoticeBox>
      ))}

      <TextField label="Staff Number" value={form.staffNo} onChange={(v) => set('staffNo', v)} maxLength={20} help="Employee/Staff identification number (if applicable)" />

      <View style={{ marginBottom: 14 }}>
        <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 6, fontWeight: '500' }}>Branch</Text>
        <Text style={{ fontSize: 16, color: colors.text }}>{props.branchCode}</Text>
        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 6 }}>The member is registered to your branch.</Text>
      </View>

      {props.guardianNeeded ? (
        <View>
          <SectionTitle>Guardian information (required for minors)</SectionTitle>
          <TextField label="Guardian Full Name" required value={form.guardian.name} onChange={(v) => setGuardian('name', v)} error={errorFor('guardian.name')} autoCapitalize="words" maxLength={200} help="Legal guardian's full name" />
          <TextField label="Guardian ID Number" required value={form.guardian.nationalId} onChange={(v) => setGuardian('nationalId', v.toUpperCase())} error={errorFor('guardian.nationalId')} autoCapitalize="characters" autoCorrect={false} maxLength={30} help="Ghana Card, voter ID, NHIS or passport number" />
          <TextField label="Guardian Phone" required value={form.guardian.phone} onChange={(v) => setGuardian('phone', v)} error={errorFor('guardian.phone')} keyboardType="phone-pad" maxLength={20} help="Guardian's contact phone" />
          <TextField label="Relationship to Minor" value={form.guardian.relationship} onChange={(v) => setGuardian('relationship', v)} maxLength={50} help="e.g., Parent, Uncle, Aunt, etc." />
          <TextField label="Guardian Address" value={form.guardian.address} onChange={(v) => setGuardian('address', v)} multiline maxLength={200} help="Guardian's residential address" />
          <TextField label="Guardian Employer" value={form.guardian.employer} onChange={(v) => setGuardian('employer', v)} maxLength={200} help="Guardian's place of employment" />
        </View>
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
    <View>
      <TextField label="Primary Phone Number" required value={form.phone} onChange={(v) => set('phone', v)} error={errorFor('phone')} keyboardType="phone-pad" maxLength={16} help="Use +233######### or 0#########" />
      <TextField label="Email Address" value={form.email} onChange={(v) => set('email', v)} error={errorFor('email')} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} maxLength={150} help="Optional - important notifications will be sent here if provided" />
      {props.notices.map((n) => (
        <NoticeBox key={n} tone="warn">
          {n}
        </NoticeBox>
      ))}
      <TextField label="Contact Value (Primary Contact)" value={form.contactValue} onChange={(v) => set('contactValue', v)} maxLength={200} help="Primary contact method. Left empty, the phone and email are used." />
      <TextField label="Mobile Alert Number" value={form.mobileAlert} onChange={(v) => set('mobileAlert', v)} error={errorFor('mobileAlert')} keyboardType="phone-pad" maxLength={16} help="Mobile number for alerts. Left empty, the primary phone is used." />
      <SwitchRow label="Allow Marketing Communications" value={form.allowMarketing} onChange={(v) => set('allowMarketing', v)} />
      <TextField label="Preferred Contact Time" value={form.preferredContactTime} onChange={(v) => set('preferredContactTime', v)} maxLength={50} help="When is the best time to contact the member?" />
      <TextField label="Residential Address" required value={form.residentialAddress} onChange={(v) => set('residentialAddress', v)} error={errorFor('residentialAddress')} multiline maxLength={200} help="The member's current home address" />
      <TextField label="Address Line 1" value={form.addressLine1} onChange={(v) => set('addressLine1', v)} maxLength={200} help="Street address" />
      <TextField label="Address Line 2" value={form.addressLine2} onChange={(v) => set('addressLine2', v)} maxLength={200} help="Apartment, suite, etc." />
      <TextField label="Address Line 3" value={form.addressLine3} onChange={(v) => set('addressLine3', v)} maxLength={200} help="Additional address information" />
      <TextField label="Landmark" value={form.landmark} onChange={(v) => set('landmark', v)} maxLength={200} help="Nearby landmark for easy location" />
      <TextField label="GPS Coordinates" value={form.gpsCoordinates} onChange={(v) => set('gpsCoordinates', v)} maxLength={50} help="GPS coordinates (optional)" />
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
      />
      <TextField label="City / Town" required value={form.city} onChange={(v) => set('city', v)} error={errorFor('city')} autoCapitalize="words" maxLength={100} help="Type it, or pick a suggestion. Any place can be typed in." />
      {suggestions.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: -6, marginBottom: 14 }}>
          {suggestions.map((c) => (
            <Pressable key={c} onPress={() => set('city', c)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
              <Text style={{ color: colors.text }}>{c}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ---- 3. employment -------------------------------------------------------------

export function EmploymentStep({ form, set, errorFor }: StepProps) {
  return (
    <View>
      <TextField label="Employer Name" value={form.employerName} onChange={(v) => set('employerName', v)} maxLength={50} />
      <TextField label="Job Title" value={form.jobTitle} onChange={(v) => set('jobTitle', v)} maxLength={100} />
      <SelectField label="Employment Type" value={form.employmentType} options={toOptions(EMPLOYMENT_TYPES)} onChange={(v) => set('employmentType', v)} />
      <TextField label="Years with Employer" value={form.yearsWithEmployer} onChange={(v) => set('yearsWithEmployer', v)} error={errorFor('yearsWithEmployer')} keyboardType="decimal-pad" maxLength={6} />
      <TextField label="Employer Address" value={form.employerAddress} onChange={(v) => set('employerAddress', v)} maxLength={80} help="Employer's address" />
      <TextField label="Employer Contact" value={form.employerContact} onChange={(v) => set('employerContact', v)} maxLength={50} help="Employer's contact information" />
      <TextField label="Income Source" value={form.incomeSource} onChange={(v) => set('incomeSource', v)} maxLength={200} help="Description of income source" />
      {form.employerName.trim() === '' && (form.jobTitle || form.employmentType || form.employerAddress || form.employerContact || form.incomeSource) ? (
        <NoticeBox tone="info">Employment details are only saved when an Employer Name is given.</NoticeBox>
      ) : null}
    </View>
  );
}

// ---- 4. financial ----------------------------------------------------------------

export function FinancialStep({ form, set }: StepProps) {
  return (
    <View>
      <NoticeBox tone="info">Provide banking and compliance information as required for KYC/AML regulations.</NoticeBox>
      <TextField label="Customer Bank" value={form.customerBank} onChange={(v) => set('customerBank', v)} maxLength={100} help="Name of member's primary bank" />
      <TextField label="Customer Branch" value={form.customerBranch} onChange={(v) => set('customerBranch', v)} maxLength={100} help="Bank branch name or location" />
      <TextField label="Bank Account No" value={form.bankAccountNo} onChange={(v) => set('bankAccountNo', v)} keyboardType="number-pad" maxLength={50} help="Member's bank account number" />
      <SelectField label="Source of Funds" value={form.sourceOfFunds} options={SOURCES_OF_FUNDS} onChange={(v) => set('sourceOfFunds', v)} help="Primary source of funds for this account" />
      <SelectField label="Expected Transaction Volume" value={form.expectedTransactionVolume} options={TRANSACTION_VOLUMES} onChange={(v) => set('expectedTransactionVolume', v)} help="Estimated monthly transaction volume" />
      <SwitchRow label="Politically Exposed Person (PEP)" help="Check if the member holds or has held a prominent public position" value={form.politicallyExposed} onChange={(v) => set('politicallyExposed', v)} />
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
    <View>
      <NoticeBox tone="info">Add beneficiaries who will receive the member's benefits in case of death or incapacitation. The total allocation must equal 100%.</NoticeBox>
      <Text style={{ fontSize: 15, fontWeight: '700', color: total === 100 ? colors.ok : colors.text, marginBottom: 12 }}>
        Allocated {total}% · {left}% left
      </Text>
      {errorFor('beneficiaries') ? <Text style={{ color: colors.danger, fontSize: 13, marginBottom: 12 }}>{errorFor('beneficiaries')}</Text> : null}

      {form.beneficiaries.map((b, i) => (
        <View key={`${b.name}-${i}`} style={{ borderWidth: 1, borderColor: errorFor(`beneficiaries.${i}.name`) || errorFor(`beneficiaries.${i}.guardianName`) ? colors.danger : colors.border, borderRadius: 10, padding: 12, marginBottom: 10, backgroundColor: colors.card }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>
            {b.name} · {b.percentage}%
          </Text>
          <Text style={{ color: colors.muted, marginTop: 2 }}>
            {b.relationship}
            {b.phone ? ` · ${b.phone}` : ''}
            {b.isMinor ? ` · minor, guardian ${b.guardianName}` : ''}
          </Text>
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 8 }}>
            <Pressable
              onPress={() => {
                setDraft(b);
                set('beneficiaries', form.beneficiaries.filter((_, j) => j !== i));
              }}
            >
              <Text style={{ color: colors.primary, fontWeight: '600' }}>Edit</Text>
            </Pressable>
            <Pressable onPress={() => set('beneficiaries', form.beneficiaries.filter((_, j) => j !== i))}>
              <Text style={{ color: colors.danger, fontWeight: '600' }}>Remove</Text>
            </Pressable>
          </View>
        </View>
      ))}

      <SectionTitle>Add a beneficiary</SectionTitle>
      <TextField label="Full Name" value={draft.name} onChange={(v) => patch('name', v)} autoCapitalize="words" maxLength={30} />
      <SelectField label="Relationship" value={draft.relationship} options={toOptions(BENEFICIARY_RELATIONSHIPS)} onChange={(v) => patch('relationship', v)} />
      <TextField label="Percentage" value={draft.percentage} onChange={(v) => patch('percentage', v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" maxLength={7} help={left > 0 ? `Up to ${left}%` : 'Nothing left to allocate'} />
      <TextField label="Phone" value={draft.phone} onChange={(v) => patch('phone', v)} keyboardType="phone-pad" maxLength={20} />
      <TextField label="Email" value={draft.email} onChange={(v) => patch('email', v)} keyboardType="email-address" autoCapitalize="none" maxLength={100} />
      <TextField label="Address" value={draft.address} onChange={(v) => patch('address', v)} maxLength={30} />
      <SwitchRow label="Beneficiary is a minor" value={draft.isMinor} onChange={(v) => patch('isMinor', v)} />
      {draft.isMinor ? (
        <View>
          <TextField label="Guardian Name" value={draft.guardianName} onChange={(v) => patch('guardianName', v)} autoCapitalize="words" maxLength={200} />
          <TextField label="Guardian Phone" value={draft.guardianPhone} onChange={(v) => patch('guardianPhone', v)} keyboardType="phone-pad" maxLength={20} />
        </View>
      ) : null}
      {draftError ? <Text style={{ color: colors.danger, marginBottom: 12 }}>{draftError}</Text> : null}
      <Button title="Add beneficiary" variant="secondary" onPress={add} />
    </View>
  );
}

// ---- 6. alert preferences ---------------------------------------------------------

export function AlertsStep({ form, set }: StepProps) {
  const a = form.alerts;
  const change = (key: keyof typeof a) => (v: boolean) => set('alerts', { ...a, [key]: v });
  return (
    <View>
      <NoticeBox tone="info">Notification preferences for account activities and alerts.</NoticeBox>
      <SwitchRow label="SMS Alerts" help="Text messages to the member's phone" value={a.sms} onChange={change('sms')} />
      <SwitchRow label="Email Alerts" help="Messages to the member's email" value={a.email} onChange={change('email')} />
      <SwitchRow label="Transaction Alerts" help="Deposits and withdrawals" value={a.transaction} onChange={change('transaction')} />
      <SwitchRow label="Loan Alerts" help="Loan repayments and balances" value={a.loan} onChange={change('loan')} />
      <SwitchRow label="Maturity Alerts" help="When a fixed deposit or loan matures" value={a.maturity} onChange={change('maturity')} />
      <SwitchRow label="Promotional Alerts" help="Offers and news" value={a.promotional} onChange={change('promotional')} />
    </View>
  );
}

// ---- 7. preview ------------------------------------------------------------------

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  const text = value === null || value === undefined || value === '' ? '—' : value;
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 4 }}>
      <Text style={{ width: 130, color: colors.muted, fontSize: 13 }}>{label}</Text>
      <Text style={{ flex: 1, color: colors.text, fontSize: 14 }}>{text}</Text>
    </View>
  );
}

function Section({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{title}</Text>
        <Pressable onPress={onEdit}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>Edit</Text>
        </Pressable>
      </View>
      {children}
    </Card>
  );
}

export function PreviewStep(props: { form: RegistrationForm; types: MemberTypeOption[]; branchCode: string; guardianNeeded: boolean; goTo: (step: number) => void }) {
  const { form: f } = props;
  const type = props.types.find((t) => t.code === f.memberType);
  const yes = (v: boolean) => (v ? 'Yes' : 'No');
  return (
    <View style={{ gap: 12 }}>
      <NoticeBox tone="info">Check everything, then submit. The member is saved as pending and the office approves them.</NoticeBox>
      <Section title="Personal information" onEdit={() => props.goTo(0)}>
        <Row label="Member type" value={type?.label ?? f.memberType} />
        <Row label="Name" value={[f.title, f.firstName, f.middleName, f.lastName].filter(Boolean).join(' ')} />
        <Row label="Date of birth" value={formatDisplayDate(f.birthDate)} />
        <Row label="Gender" value={f.sex} />
        <Row label="Marital status" value={f.maritalStatus} />
        {ID_TYPES.map((t) => (f[t.field] ? <Row key={t.key} label={t.label.replace(' Number', '')} value={f[t.field]} /> : null))}
        <Row label="Registration no." value={f.registrationNo} />
        <Row label="Staff no." value={f.staffNo} />
        <Row label="Branch" value={props.branchCode} />
        {props.guardianNeeded ? (
          <View>
            <Row label="Guardian" value={f.guardian.name} />
            <Row label="Guardian ID" value={f.guardian.nationalId} />
            <Row label="Guardian phone" value={f.guardian.phone} />
            <Row label="Relationship" value={f.guardian.relationship} />
          </View>
        ) : null}
      </Section>
      <Section title="Contact information" onEdit={() => props.goTo(1)}>
        <Row label="Phone" value={f.phone} />
        <Row label="Email" value={f.email} />
        <Row label="Mobile alert" value={f.mobileAlert} />
        <Row label="Marketing" value={yes(f.allowMarketing)} />
        <Row label="Address" value={f.residentialAddress} />
        <Row label="Region" value={f.region} />
        <Row label="City" value={f.city} />
        <Row label="Landmark" value={f.landmark} />
      </Section>
      <Section title="Employment details" onEdit={() => props.goTo(2)}>
        <Row label="Employer" value={f.employerName} />
        <Row label="Job title" value={f.jobTitle} />
        <Row label="Type" value={f.employmentType} />
        <Row label="Years" value={f.yearsWithEmployer} />
      </Section>
      <Section title="Financial details" onEdit={() => props.goTo(3)}>
        <Row label="Bank" value={f.customerBank} />
        <Row label="Bank branch" value={f.customerBranch} />
        <Row label="Account no." value={f.bankAccountNo} />
        <Row label="Source of funds" value={f.sourceOfFunds} />
        <Row label="Expected volume" value={f.expectedTransactionVolume} />
        <Row label="PEP" value={yes(f.politicallyExposed)} />
      </Section>
      <Section title="KYC documents" onEdit={() => props.goTo(4)}>
        <Row label="Authorization" value={AUTHORIZATION_PREFERENCES.find((p) => p.value === f.authorizationPreference)?.label ?? ''} />
        {KYC_SLOTS.map((slot) => (
          <Row key={slot.kind} label={slot.label} value={f.documents[slot.kind] ? 'Attached' : 'Not added'} />
        ))}
      </Section>
      <Section title="Beneficiaries" onEdit={() => props.goTo(5)}>
        {f.beneficiaries.map((b, i) => (
          <Row key={i} label={`${b.percentage}%`} value={`${b.name} (${b.relationship})`} />
        ))}
        <Row label="Total" value={`${beneficiaryTotal(f.beneficiaries)}%`} />
      </Section>
      <Section title="Alert preferences" onEdit={() => props.goTo(6)}>
        <Row label="SMS / Email" value={`${yes(f.alerts.sms)} / ${yes(f.alerts.email)}`} />
        <Row label="Transactions" value={yes(f.alerts.transaction)} />
        <Row label="Loans" value={yes(f.alerts.loan)} />
        <Row label="Maturity" value={yes(f.alerts.maturity)} />
        <Row label="Promotional" value={yes(f.alerts.promotional)} />
      </Section>
    </View>
  );
}

export type { FormProblem };
