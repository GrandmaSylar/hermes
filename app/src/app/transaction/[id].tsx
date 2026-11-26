import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { depositStatus } from '@/domain/history';
import { formatAmount } from '@/domain/money';
import { shortRef } from '@/domain/receipt';
import { depositTimeline } from '@/domain/timeline';
import { PAYMENT_LABELS, PRODUCT_LABELS, type OutboxItem } from '@/domain/types';
import { useApp } from '@/state/AppProvider';
import { Reveal, Skeleton } from '@/ui/motion';
import { StatusHero, Timeline } from '@/ui/status-timeline';
import { EmptyState } from '@/ui/states';
import { Button, Card, SectionLabel, colors } from '@/ui/theme';
import { Text } from 'react-native';

function DetailRow({ label, value, last }: { label: string; value: string | null | undefined; last?: boolean }) {
  if (!value) return null;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 11, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}>
      <Text style={{ color: colors.muted, fontSize: 14 }}>{label}</Text>
      <Text selectable style={{ color: colors.text, fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' }}>{value}</Text>
    </View>
  );
}

/** One deposit: where it stands with the office, its details, and a receipt to preview, print or save. */
export default function TransactionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { repos, version } = useApp();
  const insets = useSafeAreaInsets();
  const [item, setItem] = useState<OutboxItem | null | undefined>(undefined);

  useEffect(() => {
    if (!repos || !id) return;
    void repos.outbox.list(5000).then((all) => setItem(all.find((i) => i.localTransactionId === id) ?? null));
  }, [repos, id, version]);

  if (item === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: 16, gap: 16 }}>
        <Skeleton height={120} radius={20} />
        <Skeleton height={200} radius={20} />
      </View>
    );
  }
  if (item === null) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <EmptyState icon="receipt-outline" title="Deposit not found" body="It is no longer on this phone." tone="error" />
      </View>
    );
  }

  const status = depositStatus(item);
  const when = new Date(item.collectedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 16 }}>
      <Stack.Screen options={{ title: 'Deposit' }} />
      <StatusHero status={status} title={`GHS ${formatAmount(item.amount)}`} subtitle={item.memberName} />

      <Reveal index={1}>
        <View style={{ gap: 8 }}>
          <SectionLabel>Progress</SectionLabel>
          <Card>
            <Timeline steps={depositTimeline(item, status)} />
          </Card>
        </View>
      </Reveal>

      <Reveal index={2}>
        <View style={{ gap: 8 }}>
          <SectionLabel>Details</SectionLabel>
          <Card style={{ paddingVertical: 4 }}>
            <DetailRow label="Member" value={item.memberName} />
            <DetailRow label="Member no." value={item.memberCode} />
            <DetailRow label="For" value={PRODUCT_LABELS[item.productType]} />
            <DetailRow label="Account" value={item.accountLabel} />
            <DetailRow label="Payment" value={PAYMENT_LABELS[item.paymentMode]} />
            <DetailRow label="Collected" value={when} />
            <DetailRow label="Reference" value={shortRef(item.localTransactionId)} last />
          </Card>
        </View>
      </Reveal>

      <Reveal index={3} style={{ gap: 10 }}>
        <Button title="Preview receipt" onPress={() => router.push({ pathname: '/receipt', params: { kind: 'deposit', id: item.localTransactionId, copy: '1' } })} />
        <Button title="View member" variant="secondary" onPress={() => router.push(`/member/${item.memberCode}`)} />
      </Reveal>
    </ScrollView>
  );
}
