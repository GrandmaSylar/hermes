import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { registrationStatus } from '@/domain/history';
import { fullName, type RegistrationItem } from '@/domain/registration';
import { shortRef } from '@/domain/receipt';
import { registrationTimeline } from '@/domain/timeline';
import type { Member } from '@/domain/types';
import { useApp } from '@/state/AppProvider';
import { Reveal, Skeleton } from '@/ui/motion';
import { StatusHero, Timeline } from '@/ui/status-timeline';
import { EmptyState } from '@/ui/states';
import { Button, Card, SectionLabel, colors } from '@/ui/theme';

function DetailRow({ label, value, last }: { label: string; value: string | null | undefined; last?: boolean }) {
  if (!value) return null;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 11, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}>
      <Text style={{ color: colors.muted, fontSize: 14 }}>{label}</Text>
      <Text selectable style={{ color: colors.text, fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' }}>{value}</Text>
    </View>
  );
}

/** One registered member: where it stands with the office, their details, and a slip to preview, print or save. */
export default function RegistrationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { repos, version } = useApp();
  const insets = useSafeAreaInsets();
  const [reg, setReg] = useState<RegistrationItem | null | undefined>(undefined);
  const [member, setMember] = useState<Member | null>(null);

  useEffect(() => {
    if (!repos || !id) return;
    void (async () => {
      const found = (await repos.registrations.list(1000)).find((r) => r.localRegistrationId === id) ?? null;
      setReg(found);
      setMember(found?.serverId ? await repos.members.get(found.serverId) : null);
    })();
  }, [repos, id, version]);

  if (reg === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: 16, gap: 16 }}>
        <Skeleton height={120} radius={20} />
        <Skeleton height={200} radius={20} />
      </View>
    );
  }
  if (reg === null) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <EmptyState icon="person-outline" title="Registration not found" body="It is no longer on this phone." tone="error" />
      </View>
    );
  }

  const status = registrationStatus(reg, member);
  const when = new Date(reg.capturedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 16 }}>
      <Stack.Screen options={{ title: 'Registration' }} />
      <StatusHero status={status} title={fullName(reg)} subtitle={reg.serverId ? `Member ${reg.serverId}` : 'No member number yet'} />

      <Reveal index={1}>
        <View style={{ gap: 8 }}>
          <SectionLabel>Progress</SectionLabel>
          <Card>
            <Timeline steps={registrationTimeline(reg, status)} />
          </Card>
        </View>
      </Reveal>

      <Reveal index={2}>
        <View style={{ gap: 8 }}>
          <SectionLabel>Details</SectionLabel>
          <Card style={{ paddingVertical: 4 }}>
            <DetailRow label="Name" value={fullName(reg)} />
            <DetailRow label="Member no." value={reg.serverId} />
            <DetailRow label="Phone" value={reg.phone} />
            <DetailRow label="Registered" value={when} />
            <DetailRow label="Reference" value={shortRef(reg.serverId ?? reg.localRegistrationId)} last />
          </Card>
        </View>
      </Reveal>

      <Reveal index={3} style={{ gap: 10 }}>
        <Button title="Preview slip" onPress={() => router.push({ pathname: '/receipt', params: { kind: 'registration', id: reg.localRegistrationId, copy: '1' } })} />
        {reg.serverId ? <Button title="View member" variant="secondary" onPress={() => router.push(`/member/${reg.serverId}`)} /> : null}
      </Reveal>
    </ScrollView>
  );
}
