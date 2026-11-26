import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { PressScale } from '@/ui/motion';
import { accountLabel, type DepositSummary } from '@/domain/deposit';
import { formatAmount } from '@/domain/money';
import { PAYMENT_LABELS, type AccountOption, type PaymentMode } from '@/domain/types';
import { Button, RADIUS, SHADOW, SectionLabel, colors } from '@/ui/theme';

/** One large, tappable choice in a list where exactly one can be selected. */
export function ChoiceRow(props: { selected: boolean; onPress: () => void; children: React.ReactNode; label: string }) {
  return (
    <PressScale
      accessibilityRole="radio"
      accessibilityState={{ selected: props.selected }}
      accessibilityLabel={props.label}
      onPress={props.onPress}
      scaleTo={0.985}
      style={{
        minHeight: 64,
        borderRadius: 18,
        borderWidth: 2,
        borderColor: props.selected ? colors.primary : 'transparent',
        backgroundColor: props.selected ? colors.primarySoft : colors.card,
        paddingHorizontal: 14,
        paddingVertical: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        ...RADIUS,
        ...(props.selected ? {} : SHADOW),
      }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          borderWidth: props.selected ? 0 : 2,
          borderColor: '#C4C9D4',
          backgroundColor: props.selected ? colors.primary : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {props.selected ? <Ionicons name="checkmark" size={16} color="#FFFFFF" /> : null}
      </View>
      <View style={{ flex: 1 }}>{props.children}</View>
    </PressScale>
  );
}

/** The member's accounts of the chosen type. Product name, account number and current balance for each. */
export function AccountChooser(props: {
  title: string;
  accounts: AccountOption[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <View style={{ gap: 8 }} accessibilityRole="radiogroup">
      <SectionLabel>{props.title}</SectionLabel>
      {props.accounts.map((a) => (
        <ChoiceRow key={a.id} selected={a.id === props.selectedId} onPress={() => props.onSelect(a.id)} label={`${accountLabel(a)}, balance ${a.balance}`}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{a.productName}</Text>
          <Text style={{ color: colors.muted, fontSize: 14 }}>Account {a.number}</Text>
          <Text style={{ color: colors.text, fontSize: 15, marginTop: 2 }}>Balance GHS {formatAmount(a.balance)}</Text>
        </ChoiceRow>
      ))}
    </View>
  );
}

/** Shown only when the core can handle more than cash. */
export function PaymentModeChooser(props: { modes: PaymentMode[]; selected: PaymentMode; onSelect: (mode: PaymentMode) => void }) {
  return (
    <View style={{ gap: 8 }} accessibilityRole="radiogroup">
      <SectionLabel>Mode of payment</SectionLabel>
      {props.modes.map((m) => (
        <ChoiceRow key={m} selected={m === props.selected} onPress={() => props.onSelect(m)} label={PAYMENT_LABELS[m]}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{PAYMENT_LABELS[m]}</Text>
        </ChoiceRow>
      ))}
    </View>
  );
}

/** The sheet the officer reads before the deposit is saved. Confirm saves; Back returns to editing. */
export function ConfirmDepositModal(props: {
  visible: boolean;
  summary: DepositSummary | null;
  saving: boolean;
  onConfirm: () => void;
  onBack: () => void;
}) {
  return (
    <Modal
      visible={props.visible && props.summary !== null}
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (!props.saving) props.onBack();
      }}
    >
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(16,24,40,0.5)' }} onPress={() => (props.saving ? undefined : props.onBack())} accessibilityLabel="Close" />
      {props.summary ? (
        <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: 28, maxHeight: '88%', ...RADIUS }}>
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: '#D5D9E2', marginBottom: 14 }} />
          <ScrollView>
            <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text, letterSpacing: -0.3, marginBottom: 6 }}>{props.summary.title}</Text>
            <Text style={{ color: colors.muted, marginBottom: 8 }}>Check everything before you confirm.</Text>
            {props.summary.lines.map((line, i) => (
              <View key={line.label} style={{ paddingVertical: 11, borderBottomWidth: i === props.summary!.lines.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
                <Text style={{ color: colors.muted, fontSize: 13 }}>{line.label}</Text>
                <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600', marginTop: 1 }}>{line.value}</Text>
              </View>
            ))}
            <Text style={{ color: colors.muted, fontSize: 13, marginTop: 12 }}>{props.summary.note}</Text>
          </ScrollView>
          <View style={{ gap: 10, marginTop: 16 }}>
            <Button title="Confirm" onPress={props.onConfirm} busy={props.saving} />
            <Button title="Back" variant="secondary" onPress={props.onBack} disabled={props.saving} />
          </View>
        </View>
      ) : null}
    </Modal>
  );
}
