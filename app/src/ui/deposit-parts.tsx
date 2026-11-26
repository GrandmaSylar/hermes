import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Dots, PressScale } from '@/ui/motion';
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
          borderColor: colors.faint,
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
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>{a.productName}</Text>
          <Text style={{ color: colors.muted, fontSize: 13 }}>Account {a.number}</Text>
          <Text style={{ color: colors.text, fontSize: 14, marginTop: 2 }}>Balance GHS {formatAmount(a.balance)}</Text>
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
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>{PAYMENT_LABELS[m]}</Text>
        </ChoiceRow>
      ))}
    </View>
  );
}

/**
 * The check before money is recorded. Deliberately unlike the deposit form: a centred, dark-scrimmed dialog that
 * zooms in, with a shield badge, the amount large, and a green action, so it reads as "last chance to check".
 */
export function ConfirmDepositModal(props: {
  visible: boolean;
  summary: DepositSummary | null;
  saving: boolean;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const open = props.visible && props.summary !== null;
  const zoom = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (open) {
      zoom.setValue(0);
      Animated.spring(zoom, { toValue: 1, speed: 14, bounciness: 7, useNativeDriver: true }).start();
    }
  }, [open, zoom]);

  const summary = props.summary;
  const amount = summary?.lines.find((l) => l.label === 'Amount');
  const rest = summary?.lines.filter((l) => l.label !== 'Amount') ?? [];
  const member = rest.find((l) => l.label === 'Member');
  const others = rest.filter((l) => l.label !== 'Member' && l.label !== 'Member code');
  const code = rest.find((l) => l.label === 'Member code');

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {
        if (!props.saving) props.onBack();
      }}
    >
      <View style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: 'center', padding: 22 }}>
        {summary ? (
          <Animated.View
            style={{
              opacity: zoom,
              transform: [{ scale: zoom.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) }],
              maxHeight: '92%',
            }}
          >
            {/* Badge straddling the top edge */}
            <View style={{ alignItems: 'center', zIndex: 2, marginBottom: -34 }}>
              <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: colors.ok, alignItems: 'center', justifyContent: 'center', borderWidth: 5, borderColor: colors.card, boxShadow: '0 8px 20px rgba(46, 125, 50, 0.4)' }}>
                <Ionicons name="shield-checkmark" size={32} color="#FFFFFF" />
              </View>
            </View>

            <View style={{ backgroundColor: colors.card, borderRadius: 30, paddingTop: 48, overflow: 'hidden', ...RADIUS }}>
              <ScrollView contentContainerStyle={{ paddingHorizontal: 22 }} showsVerticalScrollIndicator={false}>
                <Text style={{ textAlign: 'center', fontSize: 12, fontWeight: '700', letterSpacing: 1, color: colors.ok }}>PLEASE CONFIRM</Text>
                <Text style={{ textAlign: 'center', fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 4 }}>{summary.title.replace(/^Confirm /, '').replace(/^./, (c) => c.toUpperCase())}</Text>

                {amount ? (
                  <Text selectable adjustsFontSizeToFit numberOfLines={1} style={{ textAlign: 'center', fontSize: 30, fontWeight: '700', color: colors.text, letterSpacing: -1, marginTop: 10, fontVariant: ['tabular-nums'] }}>
                    {amount.value}
                  </Text>
                ) : null}
                {member ? (
                  <Text selectable style={{ textAlign: 'center', color: colors.muted, fontSize: 14, marginTop: 2 }}>
                    from {member.value}
                    {code ? ` · ${code.value}` : ''}
                  </Text>
                ) : null}

                {/* Perforated divider */}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 18, marginHorizontal: -22 }}>
                  <View style={{ width: 16, height: 32, borderTopRightRadius: 16, borderBottomRightRadius: 16, backgroundColor: colors.scrim }} />
                  <View style={{ flex: 1, borderTopWidth: 2, borderStyle: 'dashed', borderColor: colors.grabber }} />
                  <View style={{ width: 16, height: 32, borderTopLeftRadius: 16, borderBottomLeftRadius: 16, backgroundColor: colors.scrim }} />
                </View>

                <View style={{ gap: 12 }}>
                  {others.map((line) => (
                    <View key={line.label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 16 }}>
                      <Text style={{ color: colors.muted, fontSize: 13, flex: 1 }}>{line.label}</Text>
                      <Text selectable style={{ color: colors.text, fontSize: 14, fontWeight: '700', flex: 1.2, textAlign: 'right' }}>{line.value}</Text>
                    </View>
                  ))}
                </View>

                <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 18, padding: 12, borderRadius: 14, backgroundColor: colors.warnBg, ...RADIUS }}>
                  <Ionicons name="information-circle" size={18} color={colors.warn} style={{ marginTop: 1 }} />
                  <Text style={{ flex: 1, color: colors.warn, fontSize: 12 }}>{summary.note}</Text>
                </View>
              </ScrollView>

              <View style={{ padding: 22, paddingTop: 18, gap: 8 }}>
                <PressScale
                  accessibilityRole="button"
                  accessibilityLabel="Confirm deposit"
                  disabled={props.saving}
                  onPress={props.onConfirm}
                  scaleTo={0.98}
                  style={{ minHeight: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ok, boxShadow: '0 6px 16px rgba(46, 125, 50, 0.32)', ...RADIUS }}
                >
                  {props.saving ? (
                    <Dots color="#FFFFFF" size={7} />
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Ionicons name="lock-closed" size={18} color="#FFFFFF" />
                      <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700' }}>Confirm and save</Text>
                    </View>
                  )}
                </PressScale>
                <Pressable accessibilityRole="button" disabled={props.saving} onPress={props.onBack} style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center', opacity: props.saving ? 0.4 : 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 15, fontWeight: '600' }}>Go back and edit</Text>
                </Pressable>
              </View>
            </View>
          </Animated.View>
        ) : null}
      </View>
    </Modal>
  );
}
