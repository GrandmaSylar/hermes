import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { validateCapture, type UnsyncedTotals } from '@/domain/capture';
import {
  PRODUCT_FOR_TYPE,
  accountLabel,
  accountsFor,
  availablePaymentModes,
  buildDepositSummary,
  depositTitle,
  depositUnavailableReason,
  expectedBalance,
  findAccount,
  parseDepositType,
  preselectedAccountId,
} from '@/domain/deposit';
import { formatAmount } from '@/domain/money';
import { PAYMENT_LABELS, type Member, type OutboxItem, type PaymentMode } from '@/domain/types';
import { useApp } from '@/state/AppProvider';
import { captureCollection } from '@/sync/capture';
import { Reveal, SuccessMark } from '@/ui/motion';
import { Receipt, useBrand } from '@/ui/receipt';
import { Button, Card, Field, RADIUS, colors } from '@/ui/theme';
import { AccountChooser, ConfirmDepositModal, PaymentModeChooser } from '@/ui/deposit-parts';

/**
 * The deposit screen, shared by "Savings deposit" and "Shares deposit". The
 * `type` route parameter decides which of the member's accounts are listed.
 * The rules live in domain/deposit.ts; this file only shows them.
 */
export default function DepositScreen() {
  const { code, type: typeParam } = useLocalSearchParams<{ code: string; type?: string }>();
  const type = parseDepositType(typeParam);
  const insets = useSafeAreaInsets();
  const brand = useBrand();
  const page = { padding: 16, paddingBottom: insets.bottom + 32, gap: 16 };
  const { repos, session, newId, touch, syncNow, capabilities, version } = useApp();
  const [member, setMember] = useState<Member | null>(null);
  const [unsynced, setUnsynced] = useState<UnsyncedTotals>({ count: 0, amountMinor: 0n });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('CASH');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ item: OutboxItem; expected: string } | null>(null);
  // A ref as well as state: two quick taps can both run before the state update shows.
  const busy = useRef(false);

  useEffect(() => {
    if (!repos || !code) return;
    void repos.members.get(code).then((m) => {
      setMember(m);
      if (m && type) setSelectedId((current) => current ?? preselectedAccountId(accountsFor(m, type)));
    });
  }, [repos, code, type]);

  useEffect(() => {
    if (!repos) return;
    void repos.outbox.unsyncedTotals().then(setUnsynced);
  }, [repos, version]);

  if (!member || !repos || !session) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  if (!type) {
    return (
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={page}>
        <Reveal>
          <Text style={{ fontSize: 28, fontWeight: '800', color: colors.text, letterSpacing: -0.5 }}>What is the deposit for?</Text>
          <Text style={{ color: colors.muted, marginTop: 4 }}>{member.name}</Text>
        </Reveal>
        <Reveal index={1}><Button title="Savings deposit" onPress={() => router.replace(`/collect/${member.memberCode}?type=savings`)} /></Reveal>
        <Reveal index={2}><Button title="Shares deposit" variant="secondary" onPress={() => router.replace(`/collect/${member.memberCode}?type=shares`)} /></Reveal>
      </ScrollView>
    );
  }

  const title = depositTitle(type);
  const unavailable = depositUnavailableReason(member, type);
  if (unavailable) {
    return (
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={page}>
        <Card>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>{title}</Text>
          <Text style={{ color: colors.warn, marginTop: 8, fontSize: 16 }}>{unavailable}</Text>
        </Card>
        <Button title="Back" variant="secondary" onPress={() => router.back()} />
      </ScrollView>
    );
  }

  const accounts = accountsFor(member, type);
  const account = findAccount(accounts, selectedId);
  const modes = availablePaymentModes(capabilities);
  const showModes = modes.length > 1;
  const input = { member, productType: PRODUCT_FOR_TYPE[type], amount, account, paymentMode, allowedPaymentModes: modes };
  const problem = validateCapture(input, unsynced, session.limits);
  const expected = expectedBalance(account, amount);
  const summary = buildDepositSummary({ member, type, account, amount, paymentMode });
  // Say what is missing only once the officer has started: an empty form needs no error.
  const hint = !account ? 'Choose the account for this deposit.' : amount.trim() && problem ? problem : null;

  const confirm = async () => {
    if (busy.current || !summary || !expected) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await captureCollection(
        repos,
        session,
        { member, productType: PRODUCT_FOR_TYPE[type], amount, account, paymentMode, allowedPaymentModes: modes },
        newId,
      );
      setConfirming(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved({ item: result.item, expected });
      touch();
      // Try to deliver straight away; if offline it simply stays safe on the phone.
      void syncNow();
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  if (saved) {
    const { item } = saved;
    return (
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={page}>
        <View style={{ alignItems: 'center', gap: 8, paddingTop: 4 }}>
          <SuccessMark size={72} />
          <Reveal index={1}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ok }}>{title} saved</Text>
          </Reveal>
        </View>
        <Reveal index={2}>
          <Receipt
            brand={brand}
            title="Deposit receipt"
            amount={`GHS ${formatAmount(item.amount)}`}
            at={new Date(item.collectedAt)}
            officer={session.officerName}
            lines={[
              { label: 'Member', value: `${item.memberName} (${item.memberCode})` },
              ...(item.accountLabel ? [{ label: 'Account', value: item.accountLabel }] : []),
              { label: 'Payment', value: PAYMENT_LABELS[item.paymentMode] },
              { label: 'Expected balance', value: `GHS ${formatAmount(saved.expected)}` },
              { label: 'Reference', value: item.localTransactionId.slice(0, 8).toUpperCase() },
            ]}
            footer="Saved on this phone and waiting for the office to approve. The balance changes only after approval."
          />
        </Reveal>
        <Reveal index={3} style={{ gap: 10 }}>
          <Button title="Done" onPress={() => router.dismissTo('/(tabs)')} />
          <Button
            title="Make another deposit"
            variant="secondary"
            onPress={() => {
              setSaved(null);
              setAmount('');
              setSelectedId(preselectedAccountId(accounts));
            }}
          />
        </Reveal>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={page} keyboardShouldPersistTaps="handled">
        <Reveal>
          <Text style={{ fontSize: 13, color: colors.primary, fontWeight: '800', letterSpacing: 0.8 }}>{title.toUpperCase()}</Text>
          <Text selectable style={{ fontSize: 28, fontWeight: '800', color: colors.text, letterSpacing: -0.5 }}>{member.name}</Text>
          <Text selectable style={{ color: colors.muted, fontSize: 15 }}>{member.memberCode}</Text>
        </Reveal>

        <AccountChooser
          title={type === 'savings' ? 'Choose the savings account' : 'Choose the shares account'}
          accounts={accounts}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setError(null);
          }}
        />
        <Text style={{ color: colors.muted, fontSize: 13, marginTop: -8, marginLeft: 4 }}>Balances as of last sync.</Text>

        <Field
          label="Deposit amount (GHS)"
          value={amount}
          onChangeText={(text) => {
            setAmount(text);
            setError(null);
          }}
          keyboardType="decimal-pad"
          placeholder="0.00"
          error={error ?? hint}
          style={{ fontSize: 30, fontWeight: '800', minHeight: 68, fontVariant: ['tabular-nums'] }}
        />

        {showModes ? <PaymentModeChooser modes={modes} selected={paymentMode} onSelect={setPaymentMode} /> : null}

        {account && expected ? (
          <Reveal>
            <View
              style={{
                padding: 18,
                gap: 4,
                borderRadius: 22,
                backgroundColor: colors.primary,
                experimental_backgroundImage: `linear-gradient(150deg, ${colors.primary}, ${colors.primaryDeep})`,
                ...RADIUS,
              }}
            >
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '700', letterSpacing: 0.6 }}>EXPECTED BALANCE AFTER APPROVAL</Text>
              <Text selectable style={{ color: '#FFFFFF', fontSize: 32, fontWeight: '800', letterSpacing: -0.6, fontVariant: ['tabular-nums'] }}>GHS {formatAmount(expected)}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: 4 }}>
                {accountLabel(account)}: GHS {formatAmount(account.balance)} now, plus this deposit. Nothing posts until the office approves it. Deposits not yet approved are not counted.
              </Text>
            </View>
          </Reveal>
        ) : null}

        <Button title="Submit" onPress={() => setConfirming(true)} disabled={problem !== null || summary === null} />
        <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center' }}>
          You will check the details first. Then the deposit is saved on this phone and sent automatically, even if there is no network now.
        </Text>
      </ScrollView>

      <ConfirmDepositModal
        visible={confirming}
        summary={summary}
        saving={saving}
        onConfirm={() => void confirm()}
        onBack={() => setConfirming(false)}
      />
    </KeyboardAvoidingView>
  );
}

