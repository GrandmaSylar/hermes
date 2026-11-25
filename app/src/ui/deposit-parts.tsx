import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { accountLabel, type DepositSummary } from '@/domain/deposit';
import { formatAmount } from '@/domain/money';
import { PAYMENT_LABELS, type AccountOption, type PaymentMode } from '@/domain/types';
import { Button, colors } from '@/ui/theme';

/** One large, tappable choice in a list where exactly one can be selected. */
export function ChoiceRow(props: { selected: boolean; onPress: () => void; children: React.ReactNode; label: string }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: props.selected }}
      accessibilityLabel={props.label}
      onPress={props.onPress}
      style={{
        minHeight: 56,
        borderRadius: 10,
        borderWidth: props.selected ? 2 : 1,
        borderColor: props.selected ? colors.primary : colors.border,
        backgroundColor: props.selected ? '#EAF1FF' : colors.card,
        paddingHorizontal: 12,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          borderWidth: 2,
          borderColor: props.selected ? colors.primary : colors.muted,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {props.selected ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary }} /> : null}
      </View>
      <View style={{ flex: 1 }}>{props.children}</View>
    </Pressable>
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
      <Text style={{ fontSize: 14, color: colors.muted, fontWeight: '600' }}>{props.title}</Text>
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
      <Text style={{ fontSize: 14, color: colors.muted, fontWeight: '600' }}>Mode of payment</Text>
      {props.modes.map((m) => (
        <ChoiceRow key={m} selected={m === props.selected} onPress={() => props.onSelect(m)} label={PAYMENT_LABELS[m]}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{PAYMENT_LABELS[m]}</Text>
        </ChoiceRow>
      ))}
    </View>
  );
}

/** The window the officer reads before the deposit is saved. Confirm saves; Back returns to editing. */
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
      animationType="fade"
      onRequestClose={() => {
        if (!props.saving) props.onBack();
      }}
    >
      <View style={{ flex: 1, backgroundColor: 'rgba(16,24,40,0.55)', justifyContent: 'center', padding: 16 }}>
        {props.summary ? (
          <View style={{ backgroundColor: colors.card, borderRadius: 14, padding: 16, maxHeight: '90%' }}>
            <ScrollView>
              <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: 8 }}>{props.summary.title}</Text>
              {props.summary.lines.map((line) => (
                <View key={line.label} style={{ paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={{ color: colors.muted, fontSize: 13 }}>{line.label}</Text>
                  <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>{line.value}</Text>
                </View>
              ))}
              <Text style={{ color: colors.muted, fontSize: 13, marginTop: 10 }}>{props.summary.note}</Text>
            </ScrollView>
            <View style={{ gap: 10, marginTop: 14 }}>
              <Button title="Confirm" onPress={props.onConfirm} busy={props.saving} />
              <Button title="Back" variant="secondary" onPress={props.onBack} disabled={props.saving} />
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
