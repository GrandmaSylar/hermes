import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { OfficeProfile } from '@/data/api/contract';
import { useApp } from '@/state/AppProvider';
import { KV_LOGO, KV_OFFICE } from '@/sync/engine';
import { RADIUS, colors } from '@/ui/theme';

/** What the receipt header needs: the credit union's name, branch and logo, as last synced to the phone. */
export interface Brand {
  logo: string | null;
  creditUnion: string;
  branch: string;
}

export function useBrand(): Brand {
  const { repos, session } = useApp();
  const [brand, setBrand] = useState<Brand>({ logo: null, creditUnion: '', branch: '' });
  useEffect(() => {
    if (!repos) return;
    let live = true;
    void Promise.all([repos.kv.get(KV_LOGO), repos.kv.get(KV_OFFICE)]).then(([logo, officeText]) => {
      let office: OfficeProfile | null = null;
      try {
        office = officeText ? (JSON.parse(officeText) as OfficeProfile) : null;
      } catch {
        office = null;
      }
      if (!live) return;
      setBrand({
        logo,
        creditUnion: office?.creditUnion ?? '',
        branch: office ? `${office.branchName || 'Branch'} (${office.branchCode || session?.branchCode || ''})` : session?.branchCode ? `Branch ${session.branchCode}` : '',
      });
    });
    return () => {
      live = false;
    };
  }, [repos, session?.branchCode]);
  return brand;
}

export interface ReceiptLine {
  label: string;
  value: string;
}

/**
 * A receipt: the credit union's logo and name on top, a perforated line, then the details. It is a record of what
 * was captured on the phone, not proof the office has approved it, and says so.
 */
export function Receipt(props: { brand: Brand; title: string; amount: string; at: Date; lines: ReceiptLine[]; officer?: string; footer: string }) {
  const { brand } = props;
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 26, overflow: 'hidden', boxShadow: '0 8px 24px rgba(16, 24, 40, 0.1)', ...RADIUS }}>
      {/* Letterhead */}
      <View style={{ alignItems: 'center', gap: 6, paddingTop: 24, paddingHorizontal: 20, paddingBottom: 8 }}>
        {brand.logo ? (
          <Image source={{ uri: brand.logo }} contentFit="contain" accessibilityLabel={`${brand.creditUnion || 'Credit union'} logo`} style={{ width: 72, height: 72, borderRadius: 16 }} />
        ) : null}
        {brand.creditUnion ? <Text selectable style={{ fontSize: 15, fontWeight: '700', color: colors.text, textAlign: 'center', letterSpacing: -0.2 }}>{brand.creditUnion}</Text> : null}
        {brand.branch ? <Text selectable style={{ fontSize: 12, color: colors.muted, textAlign: 'center' }}>{brand.branch}</Text> : null}
        <View style={{ marginTop: 8, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.primarySoft }}>
          <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1, color: colors.primaryDeep }}>{props.title.toUpperCase()}</Text>
        </View>
      </View>

      <View style={{ alignItems: 'center', paddingVertical: 12 }}>
        <Text selectable style={{ fontSize: 30, fontWeight: '700', color: colors.text, letterSpacing: -1, fontVariant: ['tabular-nums'] }}>{props.amount}</Text>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
          {props.at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · {props.at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>

      {/* Perforation */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 6 }}>
        <View style={{ width: 14, height: 28, borderTopRightRadius: 14, borderBottomRightRadius: 14, backgroundColor: colors.bg }} />
        <View style={{ flex: 1, borderTopWidth: 2, borderStyle: 'dashed', borderColor: '#D5D9E2' }} />
        <View style={{ width: 14, height: 28, borderTopLeftRadius: 14, borderBottomLeftRadius: 14, backgroundColor: colors.bg }} />
      </View>

      <View style={{ paddingHorizontal: 22, paddingTop: 8, paddingBottom: 22, gap: 12 }}>
        {props.lines.map((l) => (
          <View key={l.label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 16 }}>
            <Text style={{ color: colors.muted, fontSize: 13, flex: 1 }}>{l.label}</Text>
            <Text selectable style={{ color: colors.text, fontSize: 14, fontWeight: '600', flex: 1.3, textAlign: 'right' }}>{l.value}</Text>
          </View>
        ))}
        {props.officer ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 16 }}>
            <Text style={{ color: colors.muted, fontSize: 13, flex: 1 }}>Received by</Text>
            <Text selectable style={{ color: colors.text, fontSize: 14, fontWeight: '600', flex: 1.3, textAlign: 'right' }}>{props.officer}</Text>
          </View>
        ) : null}
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6, textAlign: 'center' }}>{props.footer}</Text>
      </View>
    </View>
  );
}
