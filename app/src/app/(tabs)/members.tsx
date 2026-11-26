import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Member } from '@/domain/types';
import { useApp } from '@/state/AppProvider';
import { RADIUS, SHADOW } from '@/ui/theme';
import { PressScale, Reveal, SkeletonRow } from '@/ui/motion';
import { Avatar, Card, colors } from '@/ui/theme';

const RESULT_LIMIT = 50;

function MemberRow({ member, index }: { member: Member; index: number }) {
  const status = member.status === 'ACTIVE' ? null : member.status === 'INACTIVE' ? 'Inactive' : 'Pending approval';
  return (
    <Reveal index={index} from={10}>
      <PressScale accessibilityRole="button" accessibilityLabel={`${member.name}, ${member.memberCode}`} onPress={() => router.push(`/member/${member.memberCode}`)} scaleTo={0.985} haptic={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: colors.card, borderRadius: 18, ...RADIUS, ...SHADOW }}>
          <Avatar name={member.name} size={46} tone="soft" />
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 15, color: colors.text, fontWeight: '700' }}>{member.name}</Text>
              {member.myCustomer ? <Ionicons name="star" size={14} color={colors.star} /> : null}
            </View>
            <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>{[member.memberCode, member.phone].filter(Boolean).join(' · ')}</Text>
            {status ? (
              <View style={{ alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.warnBg }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: colors.warn }}>{status}</Text>
              </View>
            ) : null}
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.faint} />
        </View>
      </PressScale>
    </Reveal>
  );
}

export default function MembersTab() {
  const { repos, version, syncing, syncNow } = useApp();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const insets = useSafeAreaInsets();
  const [note, setNote] = useState('');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<Member[] | null>(null);
  const [total, setTotal] = useState(0);
  const [focused, setFocused] = useState(false);
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
      // Ignore answers that arrive after a newer search was started.
      if (id !== requestId.current) return;
      setResults(rows);
      setTotal(count);
    })();
  }, [repos, debounced, version]);

  // Pull down: sends waiting items, then re-downloads every member and balance.
  const refresh = async () => {
    if (syncing) return;
    setNote('');
    const report = await syncNow({ full: true });
    if (report?.offline) setNote('No connection. Showing what is on this phone.');
  };

  const searching = debounced.trim() !== '';

  return (
    <FlatList
      refreshControl={<RefreshControl refreshing={syncing} onRefresh={refresh} tintColor={colors.primary} />}
      data={results ?? []}
      keyExtractor={(m) => m.memberCode}
      renderItem={({ item, index }) => <MemberRow member={item} index={index} />}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={12}
      windowSize={7}
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 32, gap: 10 }}
      ListHeaderComponent={
        <View style={{ gap: 14, marginBottom: 6 }}>
          <Text style={{ fontSize: 26, fontWeight: '700', color: colors.text, letterSpacing: -0.6 }}>{mode === 'deposit' ? 'Take a deposit' : 'Members'}</Text>
          {mode === 'deposit' ? (
            <Reveal>
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 16, padding: 14, ...RADIUS }}>
                <Ionicons name="cash-outline" size={22} color={colors.primaryDeep} />
                <Text style={{ flex: 1, color: colors.primaryDeep, fontWeight: '600' }}>Pick who is paying in</Text>
              </View>
            </Reveal>
          ) : null}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              minHeight: 50,
              paddingHorizontal: 14,
              borderRadius: 14,
              backgroundColor: focused ? colors.card : colors.fill,
              borderWidth: 1.5,
              borderColor: focused ? colors.primary : 'transparent',
              ...RADIUS,
            }}
          >
            <Ionicons name="search" size={18} color={colors.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="Name, number, phone"
              placeholderTextColor={colors.muted}
              autoFocus={mode === 'deposit'}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              clearButtonMode="while-editing"
              style={{ flex: 1, fontSize: 15, color: colors.text, minHeight: 48 }}
            />
          </View>
          {note ? <Text style={{ color: colors.warn, fontSize: 12 }}>{note}</Text> : null}
          <Text style={{ color: colors.muted, fontSize: 12, marginLeft: 4 }}>
            {results === null
              ? 'Loading members…'
              : !searching
                ? `${total.toLocaleString()} members`
                : `${results.length}${results.length === RESULT_LIMIT ? '+' : ''} found`}
          </Text>
          {results === null ? (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {[0, 1, 2, 3].map((i) => <SkeletonRow key={i} />)}
            </Card>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        results === null ? undefined : (
          <Card style={{ alignItems: 'center', gap: 8, paddingVertical: 32 }}>
            <Ionicons name={total === 0 ? 'cloud-offline-outline' : 'search-outline'} size={32} color={colors.muted} />
            <Text style={{ color: colors.muted, textAlign: 'center' }}>
              {total === 0
                ? 'No members yet. Sync when online.'
                : !searching
                  ? 'Search for a member. Star the ones you see often.'
                  : 'No member matches.'}
            </Text>
          </Card>
        )
      }
    />
  );
}
