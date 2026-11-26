import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { OfficeProfile } from '@/data/api/contract';
import { ago, computeHomeFigures, firstName, ghs, greeting } from '@/domain/home';
import { dayLabel } from '@/domain/history';
import type { RegistrationItem } from '@/domain/registration';
import type { Member, OutboxItem } from '@/domain/types';
import { useApp } from '@/state/AppProvider';
import { KV_OFFICE, KV_PULLED_AT } from '@/sync/engine';
import { DepositRow, RADIUS, RegistrationRow, Tappable, nums, shadow } from '@/ui/activity-rows';
import { PressScale, Reveal, SkeletonRow } from '@/ui/motion';
import { Watermark } from '@/ui/brand';
import { brand, brandGradient } from '@/ui/colors';
import { colors } from '@/ui/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const day = () => new Date().toISOString().slice(0, 10);

type Entry = { at: string; key: string; deposit?: OutboxItem; registration?: RegistrationItem };
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

function Segmented({ value, onChange }: { value: 'today' | 'all'; onChange: (v: 'today' | 'all') => void }) {
  const option = (key: 'today' | 'all', label: string) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityState={{ selected: value === key }}
      onPress={() => onChange(key)}
      style={{ flex: 1, minHeight: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: value === key ? '#FFFFFF' : 'transparent' }}
    >
      <Text style={{ fontSize: 12, fontWeight: '600', color: value === key ? colors.primaryDeep : 'rgba(255,255,255,0.85)' }}>{label}</Text>
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
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{props.title}</Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>{props.hint}</Text>
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
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, ...nums }}>{value}</Text>
        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 1 }}>{label}</Text>
      </View>
    </View>
  );
}

export default function HomeTab() {
  const { repos, version, session, capabilities, syncing, syncNow, lastSyncAt } = useApp();
  const insets = useSafeAreaInsets();
  const [range, setRange] = useState<'today' | 'all'>('today');
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [members, setMembers] = useState(0);
  const [registered, setRegistered] = useState(0);
  const [regs, setRegs] = useState<RegistrationItem[]>([]);
  const [approved, setApproved] = useState<Record<string, Pick<Member, 'status'>>>({});
  const [office, setOffice] = useState<OfficeProfile | null>(null);
  const [pulledAt, setPulledAt] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [loaded, setLoaded] = useState(false);
  const now = new Date();

  useEffect(() => {
    if (!repos) return;
    let live = true;
    (async () => {
      const [list, count, registrations, officeText, pulled] = await Promise.all([
        repos.outbox.list(1000),
        repos.members.count(),
        repos.registrations.list(500),
        repos.kv.get(KV_OFFICE),
        repos.kv.get(KV_PULLED_AT),
      ]);
      if (!live) return;
      setItems(list);
      setMembers(count);
      setRegistered(registrations.filter((r) => r.status !== 'REJECTED').length);
      setRegs(registrations);
      const found: Record<string, Pick<Member, 'status'>> = {};
      for (const r of registrations.filter((x) => x.serverId && x.capturedAt.slice(0, 10) === day())) {
        const m = await repos.members.get(r.serverId!);
        if (m) found[r.serverId!] = m;
      }
      if (!live) return;
      setApproved(found);
      setLoaded(true);
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
  // Today's activity: deposits and registrations together, latest first.
  const today = day();
  const entries: Entry[] = [
    ...items.filter((i) => i.collectedAt.slice(0, 10) === today).map((deposit) => ({ at: deposit.collectedAt, key: deposit.localTransactionId, deposit })),
    ...regs.filter((r) => r.capturedAt.slice(0, 10) === today).map((registration) => ({ at: registration.capturedAt, key: registration.localRegistrationId, registration })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const recent = entries.slice(0, 4);
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
      <Reveal style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 14, color: colors.muted, fontWeight: '500' }}>{greeting(now)}, {firstName(name)}</Text>
          <Text selectable numberOfLines={2} style={{ fontSize: 24, fontWeight: '700', color: colors.text, letterSpacing: -0.4 }}>{name || 'Field officer'}</Text>
        </View>
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: colors.primaryText, fontSize: 16, fontWeight: '700' }}>{initials(name)}</Text>
        </View>
      </Reveal>

      {officeLineText ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: -8 }}>
          <Ionicons name="business-outline" size={16} color={colors.muted} />
          <Text selectable numberOfLines={2} style={{ flex: 1, fontSize: 13, color: colors.muted }}>{officeLineText}</Text>
        </View>
      ) : null}

      {/* Cash */}
      <Reveal index={1}>
      <View
        style={{
          padding: 20,
          gap: 16,
          borderRadius: 24,
          backgroundColor: brand.navy,
          overflow: 'hidden',
          experimental_backgroundImage: brandGradient(145),
          boxShadow: '0 8px 24px rgba(3, 48, 92, 0.32)',
          ...RADIUS,
        }}
      >
        <Watermark size={220} />
        <Segmented value={range} onChange={setRange} />
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', fontWeight: '500' }}>Cash {range === 'today' ? 'today' : 'in total'}</Text>
          <Text selectable adjustsFontSizeToFit numberOfLines={1} style={{ fontSize: 30, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.8, ...nums }}>{ghs(shown.amount)}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 24 }}>
          <View>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF', ...nums }}>{shown.count}</Text>
            <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>{shown.count === 1 ? 'deposit' : 'deposits'}</Text>
          </View>
          <View>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF', ...nums }}>{figures.waitingToSync}</Text>
            <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>waiting to sync</Text>
          </View>
          <View>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF', ...nums }}>{figures.awaitingOffice}</Text>
            <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>with the office</Text>
          </View>
        </View>
      </View>
      </Reveal>

      {figures.needAttention > 0 ? (
        <Tappable onPress={() => router.push('/history')} label="Items need attention">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: colors.dangerBg, borderRadius: 16, ...RADIUS }}>
            <Ionicons name="alert-circle" size={22} color={colors.danger} />
            <Text style={{ flex: 1, color: colors.danger, fontWeight: '600' }}>
              {figures.needAttention} {figures.needAttention === 1 ? 'deposit' : 'deposits'} refused
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.danger} />
          </View>
        </Tappable>
      ) : null}

      {/* Actions */}
      <Reveal index={2} style={{ flexDirection: 'row', gap: 12 }}>
        <ActionTile icon="cash-outline" title="Take a deposit" hint="Savings or shares" tone="blue" onPress={() => router.navigate({ pathname: '/members', params: { mode: 'deposit' } })} />
        <ActionTile
          icon="person-add-outline"
          title="Register member"
          hint={capabilities.registration ? 'With KYC' : 'Not available'}
          tone="green"
          disabled={!capabilities.registration}
          onPress={() => router.push('/register')}
        />
      </Reveal>

      {/* Numbers */}
      <Reveal index={3} style={{ flexDirection: 'row', gap: 12 }}>
        <StatTile icon="people-outline" label="Members" value={members.toLocaleString()} />
        <StatTile icon="person-add-outline" label="Registered by me" value={String(registered)} />
        <StatTile icon="receipt-outline" label="Deposits, all time" value={String(figures.allTime.count)} />
      </Reveal>

      {/* Today */}
      <Reveal index={4} style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 4 }}>
          <View>
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>Today</Text>
            <Text style={{ fontSize: 12, color: colors.muted }}>{dayLabel(today)}</Text>
          </View>
          <Pressable accessibilityRole="link" onPress={() => router.push('/history')} hitSlop={10}>
            <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '500' }}>History</Text>
          </Pressable>
        </View>
        <View style={{ backgroundColor: colors.card, borderRadius: 20, overflow: 'hidden', ...RADIUS, ...shadow }}>
          {!loaded ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : recent.length === 0 ? (
            <View style={{ padding: 28, alignItems: 'center', gap: 8 }}>
              <Ionicons name="today-outline" size={32} color={colors.muted} />
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>Nothing recorded today</Text>
              <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center' }}>Today's deposits and registrations appear here.</Text>
            </View>
          ) : (
            recent.map((e, i) =>
              e.deposit ? (
                <DepositRow key={e.key} item={e.deposit} last={i === recent.length - 1} withDay={false} />
              ) : (
                <RegistrationRow key={e.key} item={e.registration!} member={e.registration!.serverId ? (approved[e.registration!.serverId] ?? null) : null} last={i === recent.length - 1} withDay={false} />
              ),
            )
          )}
        </View>
        {entries.length > recent.length ? (
          <Text style={{ fontSize: 12, color: colors.muted, paddingHorizontal: 4 }}>
            +{entries.length - recent.length} more in History
          </Text>
        ) : null}
      </Reveal>

      {/* Sync */}
      <Tappable onPress={refresh} label="Sync now" disabled={syncing}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: colors.card, borderRadius: 16, ...RADIUS, ...shadow }}>
          <Ionicons name={syncing ? 'sync' : 'cloud-done-outline'} size={22} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>{syncing ? 'Syncing…' : ago(lastSyncAt ?? pulledAt, now)}</Text>
            <Text style={{ fontSize: 12, color: note ? colors.warn : colors.muted }}>{note || 'Tap to sync now'}</Text>
          </View>
          <Ionicons name="refresh" size={18} color={colors.muted} />
        </View>
      </Tappable>
    </ScrollView>
  );
}
