import { useEffect, useState } from 'react';
import { Alert, FlatList, Switch, Text, View } from 'react-native';
import { formatAmount } from '@/domain/money';
import { officeLine } from '@/domain/office';
import { fullName, type RegistrationItem } from '@/domain/registration';
import { PRODUCT_LABELS, type OutboxItem } from '@/domain/types';
import { useApp } from '@/state/AppProvider';
import { Button, Card, StatusPill, colors } from '@/ui/theme';

function describeReport(offline: boolean, authError: boolean, pushed: number, registrations: number, pulled: number): string {
  if (authError) return 'Your session has ended. Sign in again.';
  if (offline) return 'No connection. Items stay safe on this phone and sync automatically.';
  const regs = registrations > 0 ? `, ${registrations} registration${registrations === 1 ? '' : 's'}` : '';
  return `Last sync: ${pushed} collection${pushed === 1 ? '' : 's'} sent${regs}, ${pulled} members refreshed.`;
}

function OfficeStatusLine({ item }: { item: OutboxItem }) {
  const line = officeLine(item);
  if (!line) return null;
  const color = line.tone === 'good' ? colors.ok : line.tone === 'bad' ? colors.danger : colors.muted;
  return <Text style={{ color, marginTop: 6, fontWeight: line.tone === 'wait' ? '400' : '600' }}>{line.text}</Text>;
}

export default function SyncTab() {
  const { repos, version, syncing, syncNow, lastReport, lastSyncAt, simulateOffline, setSimulateOffline, signOut } = useApp();
  const [items, setItems] = useState<OutboxItem[]>([]);

  const [registrations, setRegistrations] = useState<RegistrationItem[]>([]);

  useEffect(() => {
    if (!repos) return;
    void repos.outbox.list(100).then(setItems);
    void repos.registrations.list(50).then(setRegistrations);
  }, [repos, version]);

  const isWaiting = (s: OutboxItem['status']) => s === 'PENDING' || s === 'SENDING';
  const waiting = items.filter((i) => isWaiting(i.status)).length + registrations.filter((r) => isWaiting(r.status)).length;

  const confirmSignOut = async () => {
    const done = await signOut();
    if (!done) {
      Alert.alert(
        'Items are waiting to sync',
        'Signing out removes the data on this phone. Sync first so no collection is lost.',
      );
    }
  };

  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.localTransactionId}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      ListHeaderComponent={
        <View style={{ gap: 12, marginBottom: 6 }}>
          <Card>
            <Text style={{ fontSize: 22, fontWeight: '700', color: colors.text }}>{waiting} waiting to sync</Text>
            <Text style={{ color: colors.muted, marginTop: 4 }}>
              {lastReport
                ? describeReport(lastReport.offline, lastReport.authError, lastReport.pushed, lastReport.registrationsSent, lastReport.pulledMembers)
                : 'Not synced yet in this session.'}
            </Text>
            {lastSyncAt ? <Text style={{ color: colors.muted, marginTop: 2 }}>At {new Date(lastSyncAt).toLocaleTimeString()}</Text> : null}
            <View style={{ height: 12 }} />
            <Button title="Sync now" onPress={() => void syncNow()} busy={syncing} />
          </Card>

          {__DEV__ ? (
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={{ fontWeight: '600', color: colors.text }}>Simulate no network</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>Development only. Test offline capture and automatic sync.</Text>
                </View>
                <Switch value={simulateOffline} onValueChange={setSimulateOffline} />
              </View>
            </Card>
          ) : null}

          {registrations.length > 0 ? (
            <View style={{ gap: 10 }}>
              <Text style={{ color: colors.muted, fontSize: 12 }}>MEMBER REGISTRATIONS</Text>
              {registrations.map((r) => (
                <Card key={r.localRegistrationId}>
                  <Text style={{ fontWeight: '600', color: colors.text }}>{fullName(r)}</Text>
                  <Text style={{ color: colors.muted, marginTop: 2 }}>
                    {r.phone} · {new Date(r.capturedAt).toLocaleString()}
                  </Text>
                  <View style={{ height: 8 }} />
                  <StatusPill status={r.status} />
                  {r.serverId ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>Draft reference {r.serverId}</Text> : null}
                  {r.lastError ? <Text style={{ color: colors.danger, marginTop: 6 }}>{r.lastError}</Text> : null}
                </Card>
              ))}
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>COLLECTIONS</Text>
            </View>
          ) : null}
        </View>
      }
      renderItem={({ item }) => (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontWeight: '600', color: colors.text, flexShrink: 1 }}>{item.memberName}</Text>
            <Text style={{ fontWeight: '700', color: colors.text }}>GHS {formatAmount(item.amount)}</Text>
          </View>
          <Text style={{ color: colors.muted, marginTop: 2 }}>
            {PRODUCT_LABELS[item.productType]} · {new Date(item.collectedAt).toLocaleString()}
          </Text>
          <View style={{ height: 8 }} />
          <StatusPill status={item.status} />
          {item.serverId ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>Reference {item.serverId}</Text> : null}
          {item.lastError ? <Text style={{ color: colors.danger, marginTop: 6 }}>{item.lastError}</Text> : null}
          <OfficeStatusLine item={item} />
        </Card>
      )}
      ListEmptyComponent={<Text style={{ color: colors.muted, textAlign: 'center', padding: 24 }}>No collections captured yet.</Text>}
      ListFooterComponent={
        <View style={{ marginTop: 16 }}>
          <Button title="Sign out" variant="secondary" onPress={() => void confirmSignOut()} />
        </View>
      }
    />
  );
}
