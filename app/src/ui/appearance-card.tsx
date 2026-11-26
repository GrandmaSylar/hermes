import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';
import { useApp } from '@/state/AppProvider';
import { PREFERENCES, type Preference } from '@/ui/appearance';
import { PressScale } from '@/ui/motion';
import { Card, RADIUS, SectionLabel, colors } from '@/ui/theme';

const ICON: Record<Preference, React.ComponentProps<typeof Ionicons>['name']> = {
  system: 'phone-portrait-outline',
  light: 'sunny-outline',
  dark: 'moon-outline',
};

/** System, Light or Dark. Dark is true black, so it saves battery on OLED screens. */
export function AppearanceCard() {
  const { appearance } = useApp();
  return (
    <View style={{ gap: 8 }}>
      <SectionLabel>Appearance</SectionLabel>
      <Card style={{ padding: 6 }}>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {PREFERENCES.map((p) => {
            const on = appearance.preference === p.value;
            return (
              <PressScale
                key={p.value}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${p.label} appearance`}
                onPress={() => appearance.setPreference(p.value)}
                scaleTo={0.97}
                style={{ flex: 1, alignItems: 'center', gap: 4, paddingVertical: 12, borderRadius: 14, backgroundColor: on ? colors.primarySoft : 'transparent', ...RADIUS }}
              >
                <Ionicons name={ICON[p.value]} size={22} color={on ? colors.primary : colors.muted} />
                <Text style={{ fontSize: 13, fontWeight: on ? '700' : '500', color: on ? colors.primaryDeep : colors.muted }}>{p.label}</Text>
              </PressScale>
            );
          })}
        </View>
      </Card>
    </View>
  );
}
