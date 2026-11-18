import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { computeDayMetrics, type DayMetrics } from '@/domain/metrics';
import { formatAmount } from '@/domain/money';
import type { Member } from '@/domain/types';
import { useApp } from '@/state/AppProvider';
import { Button, Card, colors } from '@/ui/theme';

const RESULT_LIMIT = 50;
const today = () => new Date().toISOString().slice(0, 10);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: colors.muted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700', marginTop: 2 }}>{value}</Text>
    </View>
  );
}

function MemberRow({ member }: { member: Member }) {
  return (
    <Pressable
      onPress={() => router.push(`/member/${member.memberCode}`)}
      style={({ pressed }) => ({
        paddingVertical: 12,
        paddingHorizontal: 16,
        backgroundColor: pressed ? '#EEF2F6' : colors.card,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 16, color: colors.text, fontWeight: '600', flexShrink: 1 }}>
          {member.myCustomer ? '★ ' : ''}
          {member.name}
        </Text>
        {member.status !== 'ACTIVE' ? (
          <Text style={{ fontSize: 12, color: colors.warn }}>{member.status === 'INACTIVE' ? 'Inactive' : 'Pending approval'}</Text>
        ) : null}
      </View>
      <Text style={{ color: colors.muted, marginTop: 2 }}>
        {member.memberCode} · {member.phone}
      </Text>
    </Pressable>
  );
}

export default function MembersTab() {
  const { repos, version, session, capabilities } = useApp();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<Member[]>([]);
  const [total, setTotal] = useState(0);
  const [metrics, setMetrics] = useState<DayMetrics | null>(null);
  const [registered, setRegistered] = useState(0);
  const requestId = useRef(0);

  // Wait briefly after typing stops, so each keystroke does not query the database.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!repos) return;
    const id = ++requestId.current;
    (async () => {
      const q = debounced.trim();
      let rows: Member[];
      if (q === '') {
        const mine = await repos.members.mine(RESULT_LIMIT);
        const frequent = await repos.members.frequent(10);
        rows = [...mine, ...frequent];
      } else {
        rows = await repos.members.search(q, RESULT_LIMIT);
      }
      const count = await repos.members.count();
      const day = computeDayMetrics(await repos.outbox.forDay(today()));
      const regs = (await repos.registrations.forDay(today())).filter((r) => r.status !== 'REJECTED').length;
      // Ignore answers that arrive after a newer search was started.
      if (id !== requestId.current) return;
      setRegistered(regs);
      setResults(rows);
      setTotal(count);
      setMetrics(day);
    })();
  }, [repos, debounced, version]);

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={results}
        keyExtractor={(m) => m.memberCode}
        renderItem={({ item }) => <MemberRow member={item} />}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        windowSize={7}
        ListHeaderComponent={
          <View style={{ padding: 16, gap: 12 }}>
            <Text style={{ color: colors.muted }}>{session?.officerName}</Text>
            <Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>TODAY (this phone, until synced)</Text>
              <View style={{ flexDirection: 'row' }}>
                <Stat label="Credits" value={`GHS ${formatAmount(metrics?.credits ?? '0')}`} />
                <Stat label="Debits" value={`GHS ${formatAmount(metrics?.debits ?? '0')}`} />
              </View>
              <View style={{ flexDirection: 'row', marginTop: 12 }}>
                <Stat label="Net cash" value={`GHS ${formatAmount(metrics?.net ?? '0')}`} />
                <Stat label="Items" value={String(metrics?.count ?? 0)} />
                <Stat label="Registered" value={String(registered)} />
              </View>
            </Card>
            {capabilities.registration ? (
              <Button title="Register a new member" variant="secondary" onPress={() => router.push('/register')} />
            ) : null}
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search name, member number or phone"
              placeholderTextColor={colors.muted}
              autoCorrect={false}
              autoCapitalize="none"
              style={{
                minHeight: 48,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                paddingHorizontal: 12,
                fontSize: 16,
                backgroundColor: colors.card,
                color: colors.text,
              }}
            />
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              {debounced.trim() === ''
                ? `My customers and frequent members · ${total.toLocaleString()} members on this phone`
                : `${results.length}${results.length === RESULT_LIMIT ? '+' : ''} found`}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <Text style={{ color: colors.muted, textAlign: 'center', padding: 32 }}>
            {total === 0
              ? 'No members yet. Connect to the network and sync.'
              : debounced.trim() === ''
                ? 'Search for a member, then tap ★ on their page to add them to My customers.'
                : 'No member matches.'}
          </Text>
        }
      />
    </View>
  );
}
