import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  PAGE_SIZE,
  RANGE_PRESETS,
  STATUS_FILTERS,
  dayLabel,
  depositStatus,
  paginate,
  presetOf,
  presetRange,
  rangeLabel,
  registrationStatus,
  withFrom,
  withTo,
  type DayRange,
  type HistoryStatus,
  type StatusFilter,
} from '@/domain/history';
import { ghs } from '@/domain/home';
import { sumAmounts } from '@/domain/money';
import type { RegistrationItem } from '@/domain/registration';
import type { Member, OutboxItem } from '@/domain/types';
import { useApp } from '@/state/AppProvider';
import { DepositRow, RADIUS, RegistrationRow, nums, shadow } from '@/ui/activity-rows';
import { Reveal, SkeletonRow } from '@/ui/motion';
import { colors } from '@/ui/theme';

type Tab = 'deposits' | 'registrations';

const toDate = (day: string) => new Date(`${day}T12:00:00.000Z`);
const fromDate = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12)).toISOString().slice(0, 10);

function Chip({ label, on, onPress, count }: { label: string; on: boolean; onPress: () => void; count?: number }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={{ minHeight: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: 'center', backgroundColor: on ? colors.primary : colors.card, borderWidth: on ? 0 : 1, borderColor: colors.border, ...RADIUS }}
    >
      <Text style={{ fontSize: 14, fontWeight: '600', color: on ? colors.primaryText : colors.text }}>
        {label}
        {count !== undefined ? ` · ${count}` : ''}
      </Text>
    </Pressable>
  );
}

/** One end of the date range: shows the day and opens the phone's calendar. */
function DateButton({ label, day, disabled, onPick }: { label: string; day: string; disabled: boolean; onPick: (day: string) => void }) {
  const [iosOpen, setIosOpen] = useState(false);
  const shown = disabled ? 'Any' : dayLabel(day);
  const chosen = (event: DateTimePickerEvent, date?: Date) => {
    if (event.type !== 'set' || !date) return;
    onPick(fromDate(date));
  };
  const open = () => {
    const value = disabled ? new Date() : toDate(day);
    if (Platform.OS === 'android') DateTimePickerAndroid.open({ value, mode: 'date', maximumDate: new Date(), onChange: chosen });
    else setIosOpen((v) => !v);
  };
  return (
    <View style={{ flex: 1 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} date: ${shown}`}
        onPress={open}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, backgroundColor: colors.card, borderRadius: 14, padding: 12, gap: 2, borderWidth: 1, borderColor: colors.border, ...RADIUS })}
      >
        <Text style={{ fontSize: 12, color: colors.muted, fontWeight: '500' }}>{label}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="calendar-outline" size={16} color={colors.primary} />
          <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>{shown}</Text>
        </View>
      </Pressable>
      {Platform.OS === 'ios' && iosOpen ? <DateTimePicker value={disabled ? new Date() : toDate(day)} mode="date" display="spinner" maximumDate={new Date()} onChange={chosen} /> : null}
    </View>
  );
}

function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (page: number) => void }) {
  const button = (label: string, icon: 'chevron-back' | 'chevron-forward', to: number, disabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => onPage(to)}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, opacity: disabled ? 0.35 : pressed ? 0.7 : 1 })}
    >
      <Ionicons name={icon} size={20} color={colors.primary} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      {button('Previous page', 'chevron-back', page - 1, page <= 1)}
      <View style={{ alignItems: 'center' }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text, ...nums }}>Page {page} of {pages}</Text>
        <Text style={{ fontSize: 12, color: colors.muted, ...nums }}>{total} in total</Text>
      </View>
      {button('Next page', 'chevron-forward', page + 1, page >= pages)}
    </View>
  );
}

export default function HistoryScreen() {
  const { repos, version } = useApp();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('deposits');
  const [range, setRange] = useState<DayRange>(() => presetRange('7d', new Date()));
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [page, setPage] = useState(1);
  const [deposits, setDeposits] = useState<OutboxItem[]>([]);
  const [registrations, setRegistrations] = useState<RegistrationItem[]>([]);
  const [members, setMembers] = useState<Record<string, Pick<Member, 'status'>>>({});
  const [loaded, setLoaded] = useState(false);
  const today = new Date();
  const all = range.from === '0000-01-01';

  useEffect(() => {
    if (!repos) return;
    let live = true;
    (async () => {
      const [d, r] = await Promise.all([repos.outbox.inRange(range.from, range.to), repos.registrations.inRange(range.from, range.to)]);
      const found: Record<string, Pick<Member, 'status'>> = {};
      await Promise.all(
        r
          .filter((x) => x.serverId)
          .map(async (x) => {
            const m = await repos.members.get(x.serverId!);
            if (m) found[x.serverId!] = m;
          }),
      );
      if (!live) return;
      setDeposits(d);
      setRegistrations(r);
      setMembers(found);
      setLoaded(true);
    })();
    return () => {
      live = false;
    };
  }, [repos, version, range]);

  const rows = useMemo(
    () =>
      tab === 'deposits'
        ? deposits.map((item) => ({ item, status: depositStatus(item) as HistoryStatus }))
        : registrations.map((item) => ({ item, status: registrationStatus(item, item.serverId ? (members[item.serverId] ?? null) : null) as HistoryStatus })),
    [tab, deposits, registrations, members],
  );
  const counts = useMemo(() => {
    const c = { ALL: rows.length, PENDING: 0, APPROVED: 0, REJECTED: 0 };
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);
  const filtered = filter === 'ALL' ? rows : rows.filter((r) => r.status === filter);
  const shown = paginate(filtered, page, PAGE_SIZE);
  const cash = tab === 'deposits' ? sumAmounts((filtered as { item: OutboxItem; status: HistoryStatus }[]).filter((r) => r.status !== 'REJECTED').map((r) => r.item.amount)) : null;

  const change = (next: () => void) => {
    next();
    setPage(1);
  };
  const preset = presetOf(range, today);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 16 }}>
      {/* Deposits or registrations */}
      <View style={{ flexDirection: 'row', padding: 3, borderRadius: 12, backgroundColor: '#E5E7EB', ...RADIUS }}>
        {(['deposits', 'registrations'] as const).map((t) => (
          <Pressable
            key={t}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === t }}
            onPress={() => change(() => { setTab(t); setFilter('ALL'); })}
            style={{ flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: tab === t ? colors.card : 'transparent', ...(tab === t ? shadow : {}) }}
          >
            <Text style={{ fontSize: 15, fontWeight: '600', color: tab === t ? colors.text : colors.muted }}>{t === 'deposits' ? 'Deposits' : 'Registered members'}</Text>
          </Pressable>
        ))}
      </View>

      {/* Dates */}
      <View style={{ gap: 10 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {RANGE_PRESETS.map((p) => (
            <Chip key={p.value} label={p.label} on={preset === p.value} onPress={() => change(() => setRange(presetRange(p.value, today)))} />
          ))}
        </ScrollView>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <DateButton label="From" day={range.from} disabled={all} onPick={(d) => change(() => setRange(withFrom(range, d)))} />
          <DateButton label="To" day={range.to} disabled={all} onPick={(d) => change(() => setRange(withTo(range, d)))} />
        </View>
      </View>

      {/* Status */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {STATUS_FILTERS.map((f) => (
          <Chip key={f.value} label={f.label} count={counts[f.value]} on={filter === f.value} onPress={() => change(() => setFilter(f.value))} />
        ))}
      </ScrollView>

      {/* Summary */}
      <View style={{ paddingHorizontal: 4, gap: 2 }}>
        <Text style={{ fontSize: 13, color: colors.muted }}>{rangeLabel(range)}</Text>
        <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text, ...nums }}>
          {filtered.length} {tab === 'deposits' ? (filtered.length === 1 ? 'deposit' : 'deposits') : filtered.length === 1 ? 'member registered' : 'members registered'}
          {cash !== null ? ` · ${ghs(cash)}` : ''}
        </Text>
        {cash !== null ? <Text style={{ fontSize: 12, color: colors.muted }}>Refused deposits are not counted in the cash.</Text> : null}
      </View>

      {/* List */}
      <View style={{ backgroundColor: colors.card, borderRadius: 20, overflow: 'hidden', ...RADIUS, ...shadow }}>
        {!loaded ? (
          [0, 1, 2, 3].map((i) => <SkeletonRow key={i} />)
        ) : shown.rows.length === 0 ? (
          <View style={{ padding: 32, alignItems: 'center', gap: 8 }}>
            <Ionicons name={tab === 'deposits' ? 'cash-outline' : 'person-add-outline'} size={32} color={colors.muted} />
            <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>Nothing here</Text>
            <Text style={{ fontSize: 14, color: colors.muted, textAlign: 'center' }}>
              No {tab === 'deposits' ? 'deposits' : 'registrations'} {filter === 'ALL' ? '' : `${filter.toLowerCase()} `}for these dates. Try a wider range.
            </Text>
          </View>
        ) : tab === 'deposits' ? (
          (shown.rows as { item: OutboxItem }[]).map((r, i) => (
            <Reveal key={r.item.localTransactionId} index={i} from={8}>
              <DepositRow item={r.item} last={i === shown.rows.length - 1} withDay />
            </Reveal>
          ))
        ) : (
          (shown.rows as { item: RegistrationItem }[]).map((r, i) => (
            <Reveal key={r.item.localRegistrationId} index={i} from={8}>
              <RegistrationRow item={r.item} member={r.item.serverId ? (members[r.item.serverId] ?? null) : null} last={i === shown.rows.length - 1} withDay />
            </Reveal>
          ))
        )}
      </View>

      {shown.total > 0 ? <Pager page={shown.page} pages={shown.pages} total={shown.total} onPage={setPage} /> : null}
    </ScrollView>
  );
}
