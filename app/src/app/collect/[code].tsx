import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { formatAmount } from '@/domain/money';
import { PRODUCT_LABELS, type Member, type OutboxItem, type ProductType } from '@/domain/types';
import { useApp } from '@/state/AppProvider';
import { captureCollection } from '@/sync/capture';
import { Button, Card, Field, balanceText, colors } from '@/ui/theme';


function balanceFor(member: Member, product: ProductType): { label: string; value: string | null } {
  switch (product) {
    case 'SAVINGS_DEPOSIT':
      return { label: 'Current savings balance', value: member.balances.savings };
    case 'SHARE_CONTRIBUTION':
      return { label: 'Current share balance', value: member.balances.shares };
    case 'LOAN_REPAYMENT':
      return { label: 'Loan outstanding', value: member.balances.loan };
  }
}

export default function CollectScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { repos, session, newId, touch, syncNow, capabilities } = useApp();
  const [member, setMember] = useState<Member | null>(null);
  const [product, setProduct] = useState<ProductType>('SAVINGS_DEPOSIT');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<OutboxItem | null>(null);

  useEffect(() => {
    if (!repos || !code) return;
    void repos.members.get(code).then(setMember);
  }, [repos, code]);

  if (!member || !repos || !session) return null;

  // Only offer what the core system can accept today.
  const PRODUCTS: ProductType[] = [
    'SAVINGS_DEPOSIT',
    ...(capabilities.shareContribution ? (['SHARE_CONTRIBUTION'] as const) : []),
    ...(capabilities.loanRepayment ? (['LOAN_REPAYMENT'] as const) : []),
  ];

  const save = async () => {
    // Guards a double tap: the button is disabled while saving, and the entry's
    // id is the primary key, so a second insert could not duplicate it anyway.
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await captureCollection(repos, session, { member, productType: product, amount, reference }, newId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(result.item);
      touch();
      // Try to deliver straight away; if offline it simply stays safe on the phone.
      void syncNow();
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Card>
          <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ok }}>Collection saved</Text>
          <Text style={{ color: colors.text, marginTop: 12, fontSize: 28, fontWeight: '700' }}>GHS {formatAmount(saved.amount)}</Text>
          <Text style={{ color: colors.text, marginTop: 4 }}>{PRODUCT_LABELS[saved.productType]}</Text>
          <Text style={{ color: colors.muted, marginTop: 2 }}>
            {saved.memberName} · {saved.memberCode}
          </Text>
          <Text style={{ color: colors.muted, marginTop: 12, fontSize: 12 }}>
            Provisional receipt. Pending approval: the balance does not change until the office approves and reconciles this collection.
          </Text>
          <Text style={{ color: colors.muted, marginTop: 8, fontSize: 12 }}>Ref {saved.localTransactionId.slice(0, 8).toUpperCase()}</Text>
        </Card>
        <Button title="Done" onPress={() => router.dismissTo('/(tabs)')} />
        <Button
          title="Collect again"
          variant="secondary"
          onPress={() => {
            setSaved(null);
            setAmount('');
            setReference('');
          }}
        />
      </ScrollView>
    );
  }

  const bal = balanceFor(member, product);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>{member.name}</Text>
        <Text style={{ color: colors.muted, marginBottom: 16 }}>{member.memberCode}</Text>

        <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 6, fontWeight: '500' }}>What is being collected</Text>
        <View style={{ gap: 8, marginBottom: 16 }}>
          {PRODUCTS.map((p) => (
            <Pressable
              key={p}
              onPress={() => setProduct(p)}
              style={{
                minHeight: 48,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: product === p ? colors.primary : colors.border,
                backgroundColor: product === p ? '#EAF1FF' : colors.card,
                paddingHorizontal: 12,
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: colors.text, fontWeight: product === p ? '700' : '500' }}>{PRODUCT_LABELS[p]}</Text>
            </Pressable>
          ))}
        </View>

        <Card>
          <Text style={{ color: colors.muted, fontSize: 12 }}>{bal.label.toUpperCase()}</Text>
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700', marginTop: 2 }}>{balanceText(bal.value, formatAmount)}</Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>As of last sync</Text>
        </Card>

        <View style={{ height: 16 }} />
        <Field
          label="Amount (GHS)"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0.00"
          error={error}
        />
        <Field label="Reference (optional)" value={reference} onChangeText={setReference} maxLength={60} />
        <Button title="Save collection" onPress={() => void save()} busy={saving} disabled={!amount.trim()} />
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 12 }}>
          Saved on this phone first, then sent automatically. Cash only. The member is told by SMS once the office has received it.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
