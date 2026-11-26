import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { ghs } from '@/domain/home';
import { STATUS_WORDS, depositStatus, registrationStatus, type HistoryStatus } from '@/domain/history';
import { officeLine } from '@/domain/office';
import { fullName, type RegistrationItem } from '@/domain/registration';
import { PRODUCT_LABELS, type Member, type OutboxItem, type ProductType } from '@/domain/types';
import { colors } from '@/ui/theme';

/** Shared look of the home screen and the history screens: iOS-style rows with an icon, two lines and a status. */

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export const RADIUS = { borderCurve: 'continuous' as const };
export const nums = { fontVariant: ['tabular-nums' as const] };
export const shadow = { boxShadow: '0 1px 2px rgba(16, 24, 40, 0.06), 0 1px 3px rgba(16, 24, 40, 0.04)' };

const PRODUCT_ICON: Record<ProductType, IconName> = {
  SAVINGS_DEPOSIT: 'wallet-outline',
  SHARE_CONTRIBUTION: 'pie-chart-outline',
  LOAN_REPAYMENT: 'card-outline',
};

const STATUS_COLOR: Record<HistoryStatus, { fg: string; bg: string }> = {
  PENDING: { fg: colors.warn, bg: colors.warnBg },
  APPROVED: { fg: colors.ok, bg: colors.okBg },
  REJECTED: { fg: colors.danger, bg: colors.dangerBg },
};

export function Tappable(props: { onPress?: () => void; label: string; children: React.ReactNode; style?: object; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      disabled={props.disabled || !props.onPress}
      onPress={props.onPress}
      style={({ pressed }) => [{ opacity: props.disabled ? 0.5 : pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] }, props.style]}
    >
      {props.children}
    </Pressable>
  );
}

export function StatusBadge({ status }: { status: HistoryStatus }) {
  const c = STATUS_COLOR[status];
  return (
    <View style={{ alignSelf: 'flex-end', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: c.bg }}>
      <Text style={{ fontSize: 11, fontWeight: '700', color: c.fg }}>{STATUS_WORDS[status]}</Text>
    </View>
  );
}

/** "14:05" on its own, or "25 Nov, 14:05" when the day is not the one being shown. */
export function timeLabel(iso: string, withDay: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return withDay ? `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${time}` : time;
}

function RowShell(props: { icon: IconName; refused: boolean; title: string; sub: string; right: string; status: HistoryStatus; note?: string | null; last: boolean; onPress?: () => void }) {
  return (
    <Tappable onPress={props.onPress} label={`${props.title}, ${props.right}, ${STATUS_WORDS[props.status]}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16 }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: props.refused ? colors.dangerBg : colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={props.icon} size={20} color={props.refused ? colors.danger : colors.primary} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>{props.title}</Text>
          <Text numberOfLines={1} style={{ fontSize: 13, color: colors.muted }}>{props.sub}</Text>
          {props.note ? <Text numberOfLines={2} style={{ fontSize: 12, color: props.refused ? colors.danger : colors.muted }}>{props.note}</Text> : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          {props.right ? (
            <Text style={{ fontSize: 16, fontWeight: '700', color: props.refused ? colors.muted : colors.text, textDecorationLine: props.refused ? 'line-through' : 'none', ...nums }}>{props.right}</Text>
          ) : null}
          <StatusBadge status={props.status} />
        </View>
      </View>
      {props.last ? null : <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 68 }} />}
    </Tappable>
  );
}

export function DepositRow({ item, last, withDay }: { item: OutboxItem; last: boolean; withDay: boolean }) {
  const status = depositStatus(item);
  const line = officeLine(item);
  const note = status === 'REJECTED' ? (item.lastError ?? line?.text ?? null) : status === 'PENDING' && item.status !== 'SYNCED' ? 'Waiting to sync' : status === 'PENDING' ? 'With the office' : null;
  return (
    <RowShell
      icon={PRODUCT_ICON[item.productType]}
      refused={status === 'REJECTED'}
      title={item.memberName}
      sub={`${PRODUCT_LABELS[item.productType]} · ${timeLabel(item.collectedAt, withDay)}`}
      right={ghs(item.amount)}
      status={status}
      note={note}
      last={last}
      onPress={() => router.push(`/member/${item.memberCode}`)}
    />
  );
}

export function RegistrationRow({ item, member, last, withDay }: { item: RegistrationItem; member: Pick<Member, 'status'> | null; last: boolean; withDay: boolean }) {
  const status = registrationStatus(item, member);
  const note = status === 'REJECTED' ? item.lastError : status === 'PENDING' ? (item.status === 'SYNCED' ? 'With the office' : 'Waiting to sync') : null;
  return (
    <RowShell
      icon="person-add-outline"
      refused={status === 'REJECTED'}
      title={fullName(item)}
      sub={`${item.serverId ? `Member ${item.serverId}` : 'No member number yet'} · ${timeLabel(item.capturedAt, withDay)}`}
      right=""
      status={status}
      note={note}
      last={last}
      onPress={item.serverId ? () => router.push(`/member/${item.serverId}`) : undefined}
    />
  );
}
