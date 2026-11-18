import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { formatAmount } from '@/domain/money';
import type { Member } from '@/domain/types';
import { useApp } from '@/state/AppProvider';
import { Button, Card, colors } from '@/ui/theme';

function BalanceRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 }}>
      <Text style={{ color: colors.muted }}>{label}</Text>
      <Text style={{ color: colors.text, fontWeight: '600' }}>GHS {formatAmount(value)}</Text>
    </View>
  );
}

export default function MemberScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { repos, version, touch } = useApp();
  const [member, setMember] = useState<Member | null | undefined>(undefined);

  useEffect(() => {
    if (!repos || !code) return;
    void repos.members.get(code).then(setMember);
  }, [repos, code, version]);

  if (member === undefined) return null;
  if (member === null) {
    return <Text style={{ padding: 24, color: colors.muted }}>Member not found on this phone.</Text>;
  }

  const toggle = async () => {
    await repos?.members.setMyCustomer(member.memberCode, !member.myCustomer);
    touch();
  };

  const active = member.status === 'ACTIVE';

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Card>
        <Text style={{ fontSize: 22, fontWeight: '700', color: colors.text }}>{member.name}</Text>
        <Text style={{ color: colors.muted, marginTop: 4 }}>
          {member.memberCode} · {member.phone}
        </Text>
        {!active ? (
          <Text style={{ color: colors.warn, marginTop: 8 }}>
            {member.status === 'INACTIVE' ? 'This member is inactive.' : 'This member is awaiting approval.'}
          </Text>
        ) : null}
      </Card>

      <Card>
        <Text style={{ color: colors.muted, fontSize: 12 }}>BALANCES</Text>
        <BalanceRow label="Savings" value={member.balances.savings} />
        <BalanceRow label="Shares" value={member.balances.shares} />
        <BalanceRow label="Loan outstanding" value={member.balances.loan} />
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 8 }}>
          As of last sync, {new Date(member.asOf).toLocaleString()}. The office confirms the final balance.
        </Text>
      </Card>

      <Button title="Collect" onPress={() => router.push(`/collect/${member.memberCode}`)} disabled={!active} />
      <Button
        title={member.myCustomer ? '★ Remove from My customers' : '☆ Add to My customers'}
        variant="secondary"
        onPress={() => void toggle()}
      />
    </ScrollView>
  );
}
