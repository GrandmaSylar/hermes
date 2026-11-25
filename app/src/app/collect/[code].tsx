import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
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
import { Button, Card, Field, colors } from '@/ui/theme';
import { AccountChooser, ConfirmDepositModal, PaymentModeChooser } from '@/ui/deposit-parts';

/**
 * The deposit screen, shared by "Savings deposit" and "Shares deposit". The
 * `type` route parameter decides which of the member's accounts are listed.
 * The rules live in domain/deposit.ts; this file only shows them.
 */
export default function DepositScreen() {
  const { code, type: typeParam } = useLocalSearchParams<{ code: string; type?: string }>();
  const type = parseDepositType(typeParam);
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

  if (!member || !repos || !session) return null;

  if (!type) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>What is the deposit for?</Text>
        <Button title="Savings deposit" onPress={() => router.replace(`/collect/${member.memberCode}?type=savings`)} />
        <Button title="Shares deposit" onPress={() => router.replace(`/collect/${member.memberCode}?type=shares`)} />
      </ScrollView>
    );
  }

  const title = depositTitle(type);
  const unavailable = depositUnavailableReason(member, type);
  if (unavailable) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
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
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Card>
          <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ok }}>{title} saved</Text>
          <Text style={{ color: colors.text, marginTop: 12, fontSize: 28, fontWeight: '700' }}>GHS {formatAmount(item.amount)}</Text>
          <Text style={{ color: colors.text, marginTop: 4, fontSize: 16 }}>
            {item.memberName} · {item.memberCode}
          </Text>
          {item.accountLabel ? <Text style={{ color: colors.muted, marginTop: 2, fontSize: 15 }}>{item.accountLabel}</Text> : null}
          <Text style={{ color: colors.muted, marginTop: 2, fontSize: 15 }}>Payment: {PAYMENT_LABELS[item.paymentMode]}</Text>
          <View style={{ height: 12 }} />
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>Saved on this phone, will be sent</Text>
          <Text style={{ color: colors.muted, marginTop: 2, fontSize: 15 }}>Waiting for the office to approve</Text>
          <Text style={{ color: colors.muted, marginTop: 12, fontSize: 14 }}>
            Expected balance after approval: GHS {formatAmount(saved.expected)}. The balance does not change until the office approves this deposit.
          </Text>
          <Text style={{ color: colors.muted, marginTop: 8, fontSize: 13 }}>Ref {item.localTransactionId.slice(0, 8).toUpperCase()}</Text>
        </Card>
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
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
        <View>
          <Text style={{ fontSize: 13, color: colors.primary, fontWeight: '700' }}>{title.toUpperCase()}</Text>
          <Text style={{ fontSize: 22, fontWeight: '700', color: colors.text }}>{member.name}</Text>
          <Text style={{ color: colors.muted, fontSize: 15 }}>{member.memberCode}</Text>
        </View>

        <AccountChooser
          title={type === 'savings' ? 'Choose the savings account' : 'Choose the shares account'}
          accounts={accounts}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setError(null);
          }}
        />
        <Text style={{ color: colors.muted, fontSize: 13, marginTop: -8 }}>Balances as of last sync.</Text>

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
          style={{ fontSize: 20 }}
        />

        {showModes ? <PaymentModeChooser modes={modes} selected={paymentMode} onSelect={setPaymentMode} /> : null}

        {account && expected ? (
          <Card>
            <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '600' }}>EXPECTED BALANCE AFTER APPROVAL</Text>
            <Text style={{ color: colors.text, fontSize: 24, fontWeight: '700', marginTop: 4 }}>GHS {formatAmount(expected)}</Text>
            <Text style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}>
              {accountLabel(account)}: GHS {formatAmount(account.balance)} now, plus this deposit. Nothing posts until the office approves it.
              Deposits not yet approved are not counted.
            </Text>
          </Card>
        ) : null}

        <Button title="Submit" onPress={() => setConfirming(true)} disabled={problem !== null || summary === null} />
        <Text style={{ color: colors.muted, fontSize: 13 }}>
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

