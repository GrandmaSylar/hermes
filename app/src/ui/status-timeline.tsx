import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';
import type { HistoryStatus } from '@/domain/history';
import type { StepState, TimelineStep } from '@/domain/timeline';
import { Reveal } from '@/ui/motion';
import { colors } from '@/ui/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// Read at the moment of drawing, so they follow light and dark.
const look = (status: HistoryStatus): { fg: string; bg: string; icon: IconName; word: string } =>
  ({
    PENDING: { fg: colors.warn, bg: colors.warnBg, icon: 'hourglass-outline' as IconName, word: 'Pending approval' },
    APPROVED: { fg: colors.ok, bg: colors.okBg, icon: 'checkmark-circle' as IconName, word: 'Approved' },
    REJECTED: { fg: colors.danger, bg: colors.dangerBg, icon: 'close-circle' as IconName, word: 'Rejected' },
  })[status];

/** The status at the top of a details screen: big, coloured, and in words. */
export function StatusHero({ status, title, subtitle }: { status: HistoryStatus; title: string; subtitle: string }) {
  const l = look(status);
  return (
    <Reveal style={{ alignItems: 'center', gap: 6, paddingVertical: 8 }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: l.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={l.icon} size={38} color={l.fg} />
      </View>
      <View style={{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: l.bg }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: l.fg }}>{l.word}</Text>
      </View>
      <Text selectable style={{ fontSize: 30, fontWeight: '700', color: colors.text, letterSpacing: -0.8, fontVariant: ['tabular-nums'] }}>{title}</Text>
      <Text selectable style={{ fontSize: 14, color: colors.muted }}>{subtitle}</Text>
    </Reveal>
  );
}

const dotFor = (state: StepState): { color: string; icon: IconName | null } =>
  ({
    done: { color: colors.ok, icon: 'checkmark' as IconName },
    current: { color: colors.warn, icon: null },
    failed: { color: colors.danger, icon: 'close' as IconName },
    todo: { color: colors.faint, icon: null },
  })[state];

/** "26 Nov, 15:05" for a timestamp, otherwise the text as it is. */
function when(detail: string): string {
  const d = new Date(detail);
  if (Number.isNaN(d.getTime()) || !/^\d{4}-\d{2}-\d{2}T/.test(detail)) return detail;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

/** The steps so far, each marked done, waiting, refused or still to come. */
export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <View>
      {steps.map((s, i) => {
        const dot = dotFor(s.state);
        const last = i === steps.length - 1;
        return (
          <View key={s.label} style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ alignItems: 'center', width: 22 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: s.state === 'todo' ? 'transparent' : dot.color, borderWidth: s.state === 'todo' ? 2 : s.state === 'current' ? 0 : 0, borderColor: dot.color, alignItems: 'center', justifyContent: 'center' }}>
                {dot.icon ? <Ionicons name={dot.icon} size={14} color="#FFFFFF" /> : s.state === 'current' ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFFFFF' }} /> : null}
              </View>
              {last ? null : <View style={{ flex: 1, width: 2, minHeight: 22, backgroundColor: colors.border, marginVertical: 2 }} />}
            </View>
            <View style={{ flex: 1, paddingBottom: last ? 0 : 14 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: s.state === 'todo' ? colors.muted : s.state === 'failed' ? colors.danger : colors.text }}>{s.label}</Text>
              {s.detail ? <Text selectable style={{ fontSize: 12, color: s.state === 'failed' ? colors.danger : colors.muted, marginTop: 1 }}>{when(s.detail)}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
