import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { OfficeProfile } from '@/data/api/contract';
import { ago, computeHomeFigures, firstName, ghs, greeting } from '@/domain/home';
import { officeLine } from '@/domain/office';
import { PRODUCT_LABELS, type OutboxItem, type ProductType } from '@/domain/types';
import { useApp } from '@/state/AppProvider';
import { KV_OFFICE, KV_PULLED_AT } from '@/sync/engine';
import { STATUS_STYLE, colors } from '@/ui/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const day = () => new Date().toISOString().slice(0, 10);
const RADIUS = { borderCurve: 'continuous' as const };
const nums = { fontVariant: ['tabular-nums' as const] };
const shadow = { boxShadow: '0 1px 2px rgba(16, 24, 40, 0.06), 0 1px 3px rgba(16, 24, 40, 0.04)' };

const PRODUCT_ICON: Record<ProductType, IconName> = {
  SAVINGS_DEPOSIT: 'wallet-outline',
  SHARE_CONTRIBUTION: 'pie-chart-outline',
  LOAN_REPAYMENT: 'card-outline',
};

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

/** "14:05" for today, "25 Nov, 14:05" otherwise. */
function when(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? `Today, ${time}` : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
}

function Tappable(props: { onPress: () => void; label: string; children: React.ReactNode; style?: object; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [{ opacity: props.disabled ? 0.5 : pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] }, props.style]}
    >
      {props.children}
    </Pressable>
  );
}

function Segmented({ value, onChange }: { value: 'today' | 'all'; onChange: (v: 'today' | 'all') => void }) {
  const option = (key: 'today' | 'all', label: string) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityState={{ selected: value === key }}
      onPress={() => onChange(key)}
      style={{ flex: 1, minHeight: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: value === key ? '#FFFFFF' : 'transparent' }}
    >
      <Text style={{ fontSize: 13, fontWeight: '600', color: value === key ? colors.primaryDeep : 'rgba(255,255,255,0.85)' }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', padding: 2, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.18)', ...RADIUS }}>
      {option('today', 'Today')}
      {option('all', 'All time')}
    </View>
  );
}

function ActionTile(props: { icon: IconName; title: string; hint: string; onPress: () => void; tone: 'blue' | 'green'; disabled?: boolean }) {
  const fg = props.tone === 'blue' ? colors.primary : colors.ok;
  const bg = props.tone === 'blue' ? colors.primarySoft : colors.okBg;
  return (
    <Tappable onPress={props.onPress} label={props.title} disabled={props.disabled} style={{ flex: 1 }}>
      <View style={{ backgroundColor: colors.card, padding: 16, gap: 12, borderRadius: 20, ...RADIUS, ...shadow }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={props.icon} size={24} color={fg} />
        </View>
        <View style={{ gap: 2 }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>{props.title}</Text>
          <Text style={{ fontSize: 13, color: colors.muted }}>{props.hint}</Text>
        </View>
      </View>
    </Tappable>
  );
}

function StatTile({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.card, padding: 14, gap: 8, borderRadius: 16, ...RADIUS, ...shadow }}>
      <Ionicons name={icon} size={20} color={colors.primary} />
      <View>
        <Text style={{ fontSize: 22, fontWeight: '700', color: colors.text, ...nums }}>{value}</Text>
        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 1 }}>{label}</Text>
      </View>
    </View>
  );
}

function ActivityRow({ item, last, now }: { item: OutboxItem; last: boolean; now: Date }) {
  const line = officeLine(item);
  const status = STATUS_STYLE[item.status];
  const tone = line ? (line.tone === 'good' ? colors.ok : line.tone === 'bad' ? colors.danger : colors.muted) : status.fg;
  const refused = item.status === 'REJECTED' || item.status === 'CONFLICT' || item.officeStatus === 'REJECTED';
  return (
    <Tappable onPress={() => router.push(`/member/${item.memberCode}`)} label={`${item.memberName}, ${ghs(item.amount)}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16 }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: refused ? colors.dangerBg : colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={PRODUCT_ICON[item.productType]} size={20} color={refused ? colors.danger : colors.primary} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>{item.memberName}</Text>
          <Text numberOfLines={1} style={{ fontSize: 13, color: colors.muted }}>
            {PRODUCT_LABELS[item.productType]} · {when(item.collectedAt, now)}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: refused ? colors.muted : colors.text, textDecorationLine: refused ? 'line-through' : 'none', ...nums }}>{ghs(item.amount)}</Text>
          <Text numberOfLines={1} style={{ fontSize: 12, color: tone, fontWeight: '500', maxWidth: 130 }}>{line?.text ?? status.label}</Text>
        </View>
      </View>
      {last ? null : <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 68 }} />}
    </Tappable>
  );
}

export default function HomeTab() {
  const { repos, version, session, capabilities, syncing, syncNow, lastSyncAt } = useApp();
  const insets = useSafeAreaInsets();
  const [range, setRange] = useState<'today' | 'all'>('today');
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [members, setMembers] = useState(0);
  const [registered, setRegistered] = useState(0);
  const [office, setOffice] = useState<OfficeProfile | null>(null);
  const [pulledAt, setPulledAt] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const now = new Date();

  useEffect(() => {
    if (!repos) return;
    let live = true;
    (async () => {
      const [list, count, regs, officeText, pulled] = await Promise.all([
        repos.outbox.list(1000),
        repos.members.count(),
        repos.registrations.list(500),
        repos.kv.get(KV_OFFICE),
        repos.kv.get(KV_PULLED_AT),
      ]);
      if (!live) return;
      setItems(list);
      setMembers(count);
      setRegistered(regs.filter((r) => r.status !== 'REJECTED').length);
      setPulledAt(pulled);
      try {
        setOffice(officeText ? (JSON.parse(officeText) as OfficeProfile) : null);
      } catch {
        setOffice(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [repos, version]);

  const figures = useMemo(() => computeHomeFigures(items, day()), [items]);
  const shown = range === 'today' ? figures.today : figures.allTime;
  const recent = items.slice(0, 4);
  const name = session?.officerName ?? '';

  const refresh = async () => {
    if (syncing) return;
    setNote('');
    const report = await syncNow({ full: true });
    if (report?.offline) setNote('No connection. Showing what is on this phone.');
  };

  const officeLineText = office
    ? [office.creditUnion, `${office.branchName || 'Branch'} (${office.branchCode || session?.branchCode})`].filter(Boolean).join(' · ')
    : session?.branchCode
      ? `Branch ${session.branchCode}`
      : '';

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="never"
      refreshControl={<RefreshControl refreshing={syncing} onRefresh={refresh} tintColor={colors.primary} />}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 32, gap: 20 }}
      style={{ backgroundColor: colors.bg }}
    >
      {/* Who and where */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 15, color: colors.muted, fontWeight: '500' }}>{greeting(now)}, {firstName(name)}</Text>
          <Text selectable numberOfLines={2} style={{ fontSize: 28, fontWeight: '800', color: colors.text, letterSpacing: -0.4 }}>{name || 'Field officer'}</Text>
        </View>
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: colors.primaryText, fontSize: 18, fontWeight: '700' }}>{initials(name)}</Text>
        </View>
      </View>

      {officeLineText ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: -8 }}>
          <Ionicons name="business-outline" size={16} color={colors.muted} />
          <Text selectable numberOfLines={2} style={{ flex: 1, fontSize: 14, color: colors.muted }}>{officeLineText}</Text>
        </View>
      ) : null}

      {/* Cash */}
      <View
        style={{
          padding: 20,
          gap: 16,
          borderRadius: 24,
          backgroundColor: colors.primary,
          experimental_backgroundImage: `linear-gradient(145deg, ${colors.primary}, ${colors.primaryDeep})`,
          boxShadow: '0 8px 24px rgba(13, 71, 161, 0.28)',
          ...RADIUS,
        }}
      >
        <Segmented value={range} onChange={setRange} />
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', fontWeight: '500' }}>Cash recorded {range === 'today' ? 'today' : 'in total'}</Text>
          <Text selectable adjustsFontSizeToFit numberOfLines={1} style={{ fontSize: 38, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.8, ...nums }}>{ghs(shown.amount)}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 24 }}>
          <View>
            <Text style={{ fontSize: 20, fontWeight: '700', color: '#FFFFFF', ...nums }}>{shown.count}</Text>
            <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>{shown.count === 1 ? 'deposit' : 'deposits'}</Text>
          </View>
          <View>
            <Text style={{ fontSize: 20, fontWeight: '700', color: '#FFFFFF', ...nums }}>{figures.waitingToSync}</Text>
            <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>waiting to sync</Text>
          </View>
          <View>
            <Text style={{ fontSize: 20, fontWeight: '700', color: '#FFFFFF', ...nums }}>{figures.awaitingOffice}</Text>
            <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>with the office</Text>
          </View>
        </View>
      </View>

      {figures.needAttention > 0 ? (
        <Tappable onPress={() => router.navigate('/sync')} label="Items need attention">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: colors.dangerBg, borderRadius: 16, ...RADIUS }}>
            <Ionicons name="alert-circle" size={22} color={colors.danger} />
            <Text style={{ flex: 1, color: colors.danger, fontWeight: '600' }}>
              {figures.needAttention} {figures.needAttention === 1 ? 'deposit was' : 'deposits were'} refused. Tap to see why.
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.danger} />
          </View>
        </Tappable>
      ) : null}

      {/* Actions */}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <ActionTile icon="cash-outline" title="Take a deposit" hint="Choose a member, enter the amount" tone="blue" onPress={() => router.navigate({ pathname: '/members', params: { mode: 'deposit' } })} />
        <ActionTile
          icon="person-add-outline"
          title="Register member"
          hint={capabilities.registration ? 'New member with KYC' : 'Not available yet'}
          tone="green"
          disabled={!capabilities.registration}
          onPress={() => router.push('/register')}
        />
      </View>

      {/* Numbers */}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <StatTile icon="people-outline" label="Members" value={members.toLocaleString()} />
        <StatTile icon="person-add-outline" label="Registered by me" value={String(registered)} />
        <StatTile icon="receipt-outline" label="Deposits, all time" value={String(figures.allTime.count)} />
      </View>

      {/* Recent */}
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 4 }}>
          <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>Recent activity</Text>
          {items.length > 0 ? (
            <Pressable accessibilityRole="link" onPress={() => router.navigate('/sync')} hitSlop={10}>
              <Text style={{ color: colors.primary, fontSize: 15, fontWeight: '500' }}>See all</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={{ backgroundColor: colors.card, borderRadius: 20, overflow: 'hidden', ...RADIUS, ...shadow }}>
          {recent.length === 0 ? (
            <View style={{ padding: 28, alignItems: 'center', gap: 8 }}>
              <Ionicons name="cash-outline" size={32} color={colors.muted} />
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>No deposits yet</Text>
              <Text style={{ fontSize: 14, color: colors.muted, textAlign: 'center' }}>Deposits you record show up here, even before they reach the office.</Text>
            </View>
          ) : (
            recent.map((item, i) => <ActivityRow key={item.localTransactionId} item={item} last={i === recent.length - 1} now={now} />)
          )}
        </View>
      </View>

      {/* Sync */}
      <Tappable onPress={refresh} label="Sync now" disabled={syncing}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: colors.card, borderRadius: 16, ...RADIUS, ...shadow }}>
          <Ionicons name={syncing ? 'sync' : 'cloud-done-outline'} size={22} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>{syncing ? 'Syncing…' : ago(lastSyncAt ?? pulledAt, now)}</Text>
            <Text style={{ fontSize: 13, color: note ? colors.warn : colors.muted }}>{note || 'Pull down or tap to sync now'}</Text>
          </View>
          <Ionicons name="refresh" size={18} color={colors.muted} />
        </View>
      </Tappable>
    </ScrollView>
  );
}
