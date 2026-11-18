import { useEffect, useState } from 'react';
import { Alert, FlatList, Switch, Text, View } from 'react-native';
import { formatAmount } from '@/domain/money';
import { PRODUCT_LABELS, type OutboxItem } from '@/domain/types';
import { useApp } from '@/state/AppProvider';
import { Button, Card, StatusPill, colors } from '@/ui/theme';

function describeReport(offline: boolean, authError: boolean, pushed: number, pulled: number): string {
  if (authError) return 'Your session has ended. Sign in again.';
  if (offline) return 'No connection. Items stay safe on this phone and sync automatically.';
  return `Last sync: ${pushed} sent, ${pulled} members refreshed.`;
}

export default function SyncTab() {
  const { repos, version, syncing, syncNow, lastReport, lastSyncAt, simulateOffline, setSimulateOffline, signOut } = useApp();
  const [items, setItems] = useState<OutboxItem[]>([]);

  useEffect(() => {
    if (!repos) return;
    void repos.outbox.list(100).then(setItems);
  }, [repos, version]);

  const waiting = items.filter((i) => i.status === 'PENDING' || i.status === 'SENDING').length;

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
                ? describeReport(lastReport.offline, lastReport.authError, lastReport.pushed, lastReport.pulledMembers)
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
