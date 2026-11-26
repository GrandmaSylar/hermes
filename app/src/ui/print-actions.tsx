import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { loadPaper, printReceipt, savePaper, saveReceiptPdf, shareReceiptText, type Outcome } from '@/data/print';
import { PAPER_WIDTHS, printPage, receiptText, type PaperWidth } from '@/domain/receipt';
import { Button, RADIUS, colors } from '@/ui/theme';
import { tap } from '@/ui/motion';

/** Which paper the printer takes. Remembered, so it is chosen once per phone. */
export function PaperChoice({ paper, onChange }: { paper: PaperWidth; onChange: (paper: PaperWidth) => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: colors.muted, letterSpacing: 0.6, textTransform: 'uppercase', marginLeft: 4 }}>Paper</Text>
      <View style={{ flexDirection: 'row', padding: 3, borderRadius: 12, backgroundColor: colors.track, ...RADIUS }}>
        {PAPER_WIDTHS.map((p) => {
          const on = p.value === paper;
          return (
            <Pressable
              key={p.value}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => {
                if (!on) tap('light');
                onChange(p.value);
                void savePaper(p.value);
              }}
              style={{ flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: on ? colors.card : 'transparent' }}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: on ? colors.text : colors.muted }}>{p.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Print, save as a PDF, or send the text to a printer app. Says plainly when one of them did not work. */
export function PrintActions({ lines, paper, logo }: { lines: string[]; paper: PaperWidth; logo: string | null }) {
  const [busy, setBusy] = useState<'print' | 'save' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async (kind: 'print' | 'save' | 'text') => {
    setProblem(null);
    if (kind !== 'text') setBusy(kind);
    const page = printPage(lines, paper, logo);
    const outcome: Outcome = kind === 'print' ? await printReceipt(page) : kind === 'save' ? await saveReceiptPdf(page) : await shareReceiptText(receiptText(lines));
    setBusy(null);
    if (!outcome.ok) setProblem(outcome.message);
  };

  return (
    <View style={{ gap: 10 }}>
      <Button title="Print receipt" busy={busy === 'print'} onPress={() => void run('print')} />
      <Button title="Save as PDF" variant="secondary" busy={busy === 'save'} onPress={() => void run('save')} />
      <Pressable accessibilityRole="button" onPress={() => void run('text')} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44 }}>
        <Ionicons name="share-outline" size={18} color={colors.primary} />
        <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '600' }}>Send to a printer app as text</Text>
      </Pressable>
      {problem ? (
        <View style={{ flexDirection: 'row', gap: 8, padding: 12, borderRadius: 12, backgroundColor: colors.dangerBg }}>
          <Ionicons name="alert-circle" size={18} color={colors.danger} />
          <Text style={{ flex: 1, color: colors.danger, fontSize: 13 }}>{problem}</Text>
        </View>
      ) : null}
    </View>
  );
}

export { loadPaper };
