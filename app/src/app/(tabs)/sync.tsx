import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Alert, FlatList, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ago, ghs } from '@/domain/home';
import { officeLine } from '@/domain/office';
import { documentSummary, fullName, type RegistrationItem } from '@/domain/registration';
import { PRODUCT_LABELS, type OutboxItem } from '@/domain/types';
import { useApp } from '@/state/AppProvider';
import { KV_PULLED_AT } from '@/sync/engine';
import { Reveal, Skeleton } from '@/ui/motion';
import { Button, Card, SectionLabel, StatusPill, colors } from '@/ui/theme';

function describeReport(offline: boolean, authError: boolean, pushed: number, registrations: number, pulled: number): string {
  if (authError) return 'Your session has ended. Sign in again.';
  if (offline) return 'Offline. Items are safe and will sync later.';
  const regs = registrations > 0 ? `, ${registrations} registration${registrations === 1 ? '' : 's'}` : '';
  return `${pushed} collection${pushed === 1 ? '' : 's'} sent${regs}, ${pulled} members refreshed.`;
}

function OfficeStatusLine({ item }: { item: OutboxItem }) {
  const line = officeLine(item);
  if (!line) return null;
  const color = line.tone === 'good' ? colors.ok : line.tone === 'bad' ? colors.danger : colors.muted;
  return <Text style={{ color, marginTop: 8, fontSize: 12, fontWeight: line.tone === 'wait' ? '400' : '600' }}>{line.text}</Text>;
}

function Note({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'bad' }) {
  return <Text style={{ color: tone === 'bad' ? colors.danger : colors.muted, fontSize: 12, marginTop: 6 }}>{children}</Text>;
}

export default function SyncTab() {
  const { repos, version, syncing, syncNow, lastReport, lastSyncAt, simulateOffline, setSimulateOffline, signOut } = useApp();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<OutboxItem[] | null>(null);
  const [registrations, setRegistrations] = useState<RegistrationItem[]>([]);
  const [pulledAt, setPulledAt] = useState<string | null>(null);

  useEffect(() => {
    if (!repos) return;
    void repos.outbox.list(100).then(setItems);
    void repos.registrations.list(50).then(setRegistrations);
    void repos.kv.get(KV_PULLED_AT).then(setPulledAt);
  }, [repos, version]);

  const isWaiting = (s: OutboxItem['status']) => s === 'PENDING' || s === 'SENDING';
  const waiting = (items ?? []).filter((i) => isWaiting(i.status)).length + registrations.filter((r) => isWaiting(r.status)).length;

  const confirmSignOut = async () => {
    const done = await signOut();
    if (!done) {
      Alert.alert('Items are waiting to sync', 'Signing out removes the data on this phone. Sync first so no collection is lost.');
    }
  };

  const report = lastReport
    ? describeReport(lastReport.offline, lastReport.authError, lastReport.pushed, lastReport.registrationsSent, lastReport.pulledMembers)
    : 'Not synced yet in this session.';
  const clear = waiting === 0;

  return (
    <FlatList
      data={items ?? []}
      keyExtractor={(i) => i.localTransactionId}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 32, gap: 12 }}
      style={{ backgroundColor: colors.bg }}
      ListHeaderComponent={
        <View style={{ gap: 16, marginBottom: 4 }}>
          <Text style={{ fontSize: 26, fontWeight: '700', color: colors.text, letterSpacing: -0.6 }}>Sync</Text>

          <Reveal>
            <Card style={{ gap: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: clear ? colors.okBg : colors.warnBg }}>
                  <Ionicons name={syncing ? 'sync' : clear ? 'checkmark-done' : 'cloud-upload-outline'} size={26} color={clear ? colors.ok : colors.warn} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, letterSpacing: -0.3 }}>
                    {syncing ? 'Syncing…' : clear ? 'All sent' : `${waiting} waiting to sync`}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                    {ago(lastSyncAt ?? pulledAt, new Date())}
                    {lastSyncAt ? ` · ${new Date(lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                  </Text>
                </View>
              </View>
              <Text style={{ color: lastReport?.offline ? colors.warn : colors.muted, fontSize: 13 }}>{report}</Text>
              <Button title="Sync now" onPress={() => void syncNow()} busy={syncing} />
            </Card>
          </Reveal>

          {__DEV__ ? (
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={{ fontWeight: '600', color: colors.text }}>Simulate no network</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>Development only. Test offline capture and automatic sync.</Text>
                </View>
                <Switch value={simulateOffline} onValueChange={setSimulateOffline} trackColor={{ true: colors.primary }} />
              </View>
            </Card>
          ) : null}

          {registrations.length > 0 ? (
            <View style={{ gap: 10 }}>
              <SectionLabel>Member registrations</SectionLabel>
              {registrations.map((r, i) => (
                <Reveal key={r.localRegistrationId} index={i}>
                  <Card>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                      <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, fontWeight: '700', color: colors.text }}>{fullName(r)}</Text>
                      <StatusPill status={r.status} />
                    </View>
                    <Text style={{ color: colors.muted, marginTop: 4, fontSize: 12 }}>
                      {r.phone} · {new Date(r.capturedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </Text>
                    {r.serverId ? <Note>Member {r.serverId}, pending approval</Note> : null}
                    {documentSummary(r.files) ? <Note>{documentSummary(r.files)}</Note> : null}
                    {r.files.filter((f) => f.status === 'REJECTED' && f.lastError).map((f) => (
                      <Note key={f.kind} tone="bad">{f.lastError}</Note>
                    ))}
                    {r.lastError ? <Note tone="bad">{r.lastError}</Note> : null}
                  </Card>
                </Reveal>
              ))}
              <SectionLabel>Collections</SectionLabel>
            </View>
          ) : (
            <SectionLabel>Collections</SectionLabel>
          )}
          {items === null ? (
            <Card style={{ gap: 14 }}>
              <Skeleton width="60%" height={16} />
              <Skeleton width="40%" height={12} />
              <Skeleton width="25%" height={22} radius={11} />
            </Card>
          ) : null}
        </View>
      }
      renderItem={({ item, index }) => (
        <Reveal index={index}>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, fontWeight: '700', color: colors.text }}>{item.memberName}</Text>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] }}>{ghs(item.amount)}</Text>
            </View>
            <Text style={{ color: colors.muted, marginTop: 4, fontSize: 12 }}>
              {PRODUCT_LABELS[item.productType]} · {new Date(item.collectedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </Text>
            {item.accountLabel ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{item.accountLabel}</Text> : null}
            <View style={{ height: 10 }} />
            <StatusPill status={item.status} />
            {item.serverId ? <Note>Reference {item.serverId}</Note> : null}
            {item.lastError ? <Note tone="bad">{item.lastError}</Note> : null}
            <OfficeStatusLine item={item} />
          </Card>
        </Reveal>
      )}
      ListEmptyComponent={
        items === null ? undefined : (
          <Card style={{ alignItems: 'center', gap: 8, paddingVertical: 32 }}>
            <Ionicons name="receipt-outline" size={32} color={colors.muted} />
            <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>No collections yet</Text>
            <Text style={{ color: colors.muted, textAlign: 'center' }}>Deposits you take appear here.</Text>
          </Card>
        )
      }
      ListFooterComponent={
        <View style={{ marginTop: 12 }}>
          <Button title="Sign out" variant="danger" onPress={() => void confirmSignOut()} />
        </View>
      }
    />
  );
}
