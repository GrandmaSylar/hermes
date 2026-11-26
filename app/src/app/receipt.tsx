import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { loadPaper } from '@/data/print';
import { depositStatus, registrationStatus } from '@/domain/history';
import { COLUMNS, depositReceipt, layoutReceipt, registrationReceipt, type PaperWidth, type ReceiptDoc } from '@/domain/receipt';
import { useApp } from '@/state/AppProvider';
import { useLetterhead } from '@/state/use-letterhead';
import { PaperChoice, PrintActions } from '@/ui/print-actions';
import { ReceiptPaper } from '@/ui/receipt-paper';
import { Skeleton } from '@/ui/motion';
import { EmptyState } from '@/ui/states';
import { colors } from '@/ui/theme';

/**
 * A receipt to look at, print or save: a deposit receipt or a registration slip, laid out for the paper in the
 * printer (58 or 80 mm). `copy=1` marks it as a reprint of something printed before.
 */
export default function ReceiptScreen() {
  const { kind, id, copy } = useLocalSearchParams<{ kind?: string; id?: string; copy?: string }>();
  const { repos } = useApp();
  const head = useLetterhead();
  const insets = useSafeAreaInsets();
  const [paper, setPaper] = useState<PaperWidth>(58);
  const [doc, setDoc] = useState<ReceiptDoc | null | undefined>(undefined);

  useEffect(() => {
    void loadPaper().then(setPaper);
  }, []);

  useEffect(() => {
    if (!repos || !id) return;
    let live = true;
    (async () => {
      const letterhead = { creditUnion: head.creditUnion, branch: head.branch, officer: head.officer };
      let built: ReceiptDoc | null = null;
      if (kind === 'registration') {
        const reg = (await repos.registrations.list(1000)).find((r) => r.localRegistrationId === id);
        if (reg) {
          const member = reg.serverId ? await repos.members.get(reg.serverId) : null;
          built = registrationReceipt(reg, registrationStatus(reg, member), letterhead, copy === '1');
        }
      } else {
        const item = (await repos.outbox.list(5000)).find((i) => i.localTransactionId === id);
        if (item) built = depositReceipt(item, depositStatus(item), letterhead, copy === '1');
      }
      if (live) setDoc(built);
    })();
    return () => {
      live = false;
    };
  }, [repos, kind, id, copy, head.creditUnion, head.branch, head.officer]);

  const lines = useMemo(() => (doc ? layoutReceipt(doc, COLUMNS[paper]) : []), [doc, paper]);

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 20 }}>
      <Stack.Screen options={{ title: kind === 'registration' ? 'Registration slip' : 'Receipt' }} />
      {doc === undefined ? (
        <View style={{ alignItems: 'center', gap: 10, paddingTop: 20 }}>
          <Skeleton width={240} height={320} radius={6} />
        </View>
      ) : doc === null ? (
        <EmptyState icon="receipt-outline" title="Receipt not found" body="It is no longer on this phone." tone="error" />
      ) : (
        <>
          <PaperChoice paper={paper} onChange={setPaper} />
          <ReceiptPaper lines={lines} paper={paper} logo={head.logo} />
          <Text style={{ fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: -6 }}>
            Shown as it will print on {paper} mm paper.
          </Text>
          <PrintActions lines={lines} paper={paper} logo={head.logo} />
        </>
      )}
    </ScrollView>
  );
}
