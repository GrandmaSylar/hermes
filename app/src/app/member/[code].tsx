import { Ionicons } from '@expo/vector-icons';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { depositTitle, depositUnavailableReason } from '@/domain/deposit';
import { formatAmount } from '@/domain/money';
import type { Member } from '@/domain/types';
import { useApp } from '@/state/AppProvider';
import { PressScale, Reveal, Skeleton, tap } from '@/ui/motion';
import { Avatar, Button, Card, RADIUS, SectionLabel, balanceText, colors } from '@/ui/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function BalanceRow({ icon, label, value, last }: { icon: IconName; label: string; value: string | null; last?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={18} color={colors.primary} />
      </View>
      <Text style={{ flex: 1, color: colors.text, fontSize: 15 }}>{label}</Text>
      <Text selectable style={{ color: value === null ? colors.muted : colors.text, fontWeight: '700', fontSize: 15, fontVariant: ['tabular-nums'] }}>{balanceText(value, formatAmount)}</Text>
    </View>
  );
}

export default function MemberScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { repos, version, touch } = useApp();
  const insets = useSafeAreaInsets();
  const [member, setMember] = useState<Member | null | undefined>(undefined);

  useEffect(() => {
    if (!repos || !code) return;
    void repos.members.get(code).then(setMember);
  }, [repos, code, version]);

  if (member === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: 16, gap: 16 }}>
        <Card style={{ alignItems: 'center', gap: 12, paddingVertical: 28 }}>
          <Skeleton width={72} height={72} radius={36} />
          <Skeleton width="50%" height={20} />
          <Skeleton width="35%" height={13} />
        </Card>
        <Card style={{ gap: 18 }}>
          <Skeleton width="70%" /><Skeleton width="60%" /><Skeleton width="65%" />
        </Card>
      </View>
    );
  }
  if (member === null) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 }}>
        <Ionicons name="person-remove-outline" size={40} color={colors.muted} />
        <Text style={{ color: colors.muted, fontSize: 15 }}>Member not found on this phone.</Text>
      </View>
    );
  }

  const toggle = async () => {
    tap('light');
    await repos?.members.setMyCustomer(member.memberCode, !member.myCustomer);
    touch();
  };

  const active = member.status === 'ACTIVE';

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 16 }}>
      <Stack.Screen
        options={{
          title: '',
          headerRight: () => (
            <PressScale accessibilityRole="button" accessibilityLabel={member.myCustomer ? 'Remove from My customers' : 'Add to My customers'} onPress={() => void toggle()} haptic={false} style={{ padding: 6 }}>
              <Ionicons name={member.myCustomer ? 'star' : 'star-outline'} size={24} color={member.myCustomer ? '#F5A623' : colors.primary} />
            </PressScale>
          ),
        }}
      />

      <Reveal>
        <View
          style={{
            alignItems: 'center',
            gap: 6,
            padding: 24,
            borderRadius: 28,
            backgroundColor: colors.primary,
            experimental_backgroundImage: `linear-gradient(150deg, ${colors.primary}, ${colors.primaryDeep})`,
            boxShadow: '0 10px 28px rgba(13, 71, 161, 0.28)',
            ...RADIUS,
          }}
        >
          <View style={{ padding: 4, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.25)' }}>
            <Avatar name={member.name} size={72} tone="soft" />
          </View>
          <Text selectable style={{ fontSize: 20, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.4, textAlign: 'center', marginTop: 6 }}>{member.name}</Text>
          <Text selectable style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>{[member.memberCode, member.phone].filter(Boolean).join(' · ')}</Text>
          {!active ? (
            <View style={{ marginTop: 8, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.warnBg }}>
              <Text style={{ color: colors.warn, fontWeight: '700', fontSize: 12 }}>{member.status === 'INACTIVE' ? 'Inactive' : 'Awaiting approval'}</Text>
            </View>
          ) : null}
        </View>
      </Reveal>

      <Reveal index={1}>
        <View style={{ gap: 8 }}>
          <SectionLabel>Balances</SectionLabel>
          <Card style={{ paddingVertical: 4 }}>
            <BalanceRow icon="wallet-outline" label="Savings" value={member.balances.savings} />
            <BalanceRow icon="pie-chart-outline" label="Shares" value={member.balances.shares} />
            <BalanceRow icon="card-outline" label="Loan outstanding" value={member.balances.loan} last />
          </Card>
          <Text style={{ color: colors.muted, fontSize: 12, marginLeft: 4 }}>
            As of {new Date(member.asOf).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
          </Text>
        </View>
      </Reveal>

      <Reveal index={2}>
        <View style={{ gap: 12 }}>
          <SectionLabel>Take a deposit</SectionLabel>
          {(['savings', 'shares'] as const).map((type) => {
            const reason = depositUnavailableReason(member, type);
            return (
              <View key={type} style={{ gap: 6 }}>
                <Button title={depositTitle(type)} onPress={() => router.push(`/collect/${member.memberCode}?type=${type}`)} disabled={reason !== null} variant={type === 'savings' ? 'primary' : 'secondary'} />
                {reason && active ? <Text style={{ color: colors.warn, fontSize: 12, marginLeft: 4 }}>{reason}</Text> : null}
              </View>
            );
          })}
        </View>
      </Reveal>
    </ScrollView>
  );
}
