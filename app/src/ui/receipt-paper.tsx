import { Image } from 'expo-image';
import { Platform, Text, View } from 'react-native';
import { COLUMNS, type PaperWidth } from '@/domain/receipt';

const MONO = Platform.select({ ios: 'Courier', default: 'monospace' });

/**
 * The receipt as it will come out of the printer: a narrow strip of paper, black monospace on white, with torn
 * edges. Always white and black, even in dark mode, because that is the paper. The type is sized so the widest
 * line just fits, as it does on the printed page.
 */
export function ReceiptPaper({ lines, paper, logo }: { lines: string[]; paper: PaperWidth; logo: string | null }) {
  const width = paper === 58 ? 260 : 340;
  const font = Math.floor((width - 28) / (COLUMNS[paper] * 0.6) * 10) / 10;
  const teeth = Math.ceil(width / 12);
  const edge = (flip: boolean) => (
    <View style={{ flexDirection: 'row', height: 7, overflow: 'hidden', marginHorizontal: -6 }} pointerEvents="none">
      {Array.from({ length: teeth + 1 }, (_, i) => (
        <View key={i} style={{ width: 12, height: 12, backgroundColor: '#FFFFFF', transform: [{ rotate: '45deg' }, { translateY: flip ? -6 : 6 }], marginRight: 0 }} />
      ))}
    </View>
  );
  return (
    <View style={{ alignSelf: 'center', width, boxShadow: '0 10px 28px rgba(0, 0, 0, 0.22)' }}>
      {edge(false)}
      <View style={{ backgroundColor: '#FFFFFF', paddingHorizontal: 14, paddingVertical: 14 }}>
        {logo ? <Image source={{ uri: logo }} contentFit="contain" accessibilityLabel="Credit union logo" style={{ width: 64, height: 44, alignSelf: 'center', marginBottom: 6 }} /> : null}
        <Text selectable style={{ fontFamily: MONO, fontSize: font, lineHeight: font * 1.3, color: '#000000' }}>
          {lines.join('\n')}
        </Text>
      </View>
      {edge(true)}
    </View>
  );
}
