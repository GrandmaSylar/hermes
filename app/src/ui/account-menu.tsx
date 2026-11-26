import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '@/state/AppProvider';
import { useSignOut } from '@/state/use-sign-out';
import { PREFERENCES, type Preference } from '@/ui/appearance';
import { Dots, PressScale, tap } from '@/ui/motion';
import { Avatar, RADIUS, colors } from '@/ui/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const APPEARANCE_ICON: Record<Preference, IconName> = { system: 'phone-portrait-outline', light: 'sunny-outline', dark: 'moon-outline' };

function Row(props: { icon: IconName; label: string; onPress: () => void; danger?: boolean; right?: React.ReactNode }) {
  const color = props.danger ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 14, backgroundColor: pressed ? colors.pressed : 'transparent' })}
    >
      <Ionicons name={props.icon} size={20} color={props.danger ? colors.danger : colors.primary} />
      <Text style={{ flex: 1, fontSize: 15, color, fontWeight: props.danger ? '600' : '500' }}>{props.label}</Text>
      {props.right}
    </Pressable>
  );
}

/**
 * The person's avatar at the top right of a screen. Tapping it drops down their account menu: who is signed in,
 * Settings, Sync now, the appearance, and Sign out.
 */
export function AccountMenu() {
  const { session, syncing, syncNow, appearance } = useApp();
  const insets = useSafeAreaInsets();
  const confirmSignOut = useSignOut();
  const [open, setOpen] = useState(false);
  const appear = useRef(new Animated.Value(0)).current;
  const name = session?.officerName ?? '';

  useEffect(() => {
    if (open) {
      appear.setValue(0);
      Animated.timing(appear, { toValue: 1, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
  }, [open, appear]);

  const close = () => setOpen(false);
  const go = (action: () => void) => () => {
    close();
    action();
  };

  return (
    <>
      <PressScale accessibilityRole="button" accessibilityLabel="Account menu" onPress={() => setOpen(true)} scaleTo={0.92}>
        <Avatar name={name} size={44} />
      </PressScale>

      <Modal visible={open} transparent animationType="none" statusBarTranslucent onRequestClose={close}>
        <Pressable accessibilityLabel="Close menu" style={{ flex: 1 }} onPress={close}>
          <Animated.View
            // Opens from the avatar's corner.
            style={{
              position: 'absolute',
              top: insets.top + 12 + 44 + 8,
              right: 16,
              width: 280,
              opacity: appear,
              transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }, { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }],
            }}
          >
            <Pressable
              // Taps inside the card must not close it.
              onPress={() => undefined}
              style={{ backgroundColor: colors.card, borderRadius: 20, overflow: 'hidden', boxShadow: '0 12px 32px rgba(0, 0, 0, 0.28)', borderWidth: 1, borderColor: colors.border, ...RADIUS }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
                <Avatar name={name} size={44} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{name || 'Field officer'}</Text>
                  <Text numberOfLines={1} style={{ fontSize: 12, color: colors.muted }}>{session?.branchCode ? `Branch ${session.branchCode}` : 'Signed in'}</Text>
                </View>
              </View>
              <View style={{ height: 1, backgroundColor: colors.border }} />

              <Row icon="settings-outline" label="Settings" onPress={go(() => router.navigate('/settings'))} />
              <Row
                icon="sync-outline"
                label="Sync now"
                onPress={() => {
                  tap('light');
                  void syncNow();
                }}
                right={syncing ? <Dots size={5} /> : undefined}
              />

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 14 }}>
                <Ionicons name="contrast-outline" size={20} color={colors.primary} />
                <Text style={{ flex: 1, fontSize: 15, color: colors.text, fontWeight: '500' }}>Appearance</Text>
                <View style={{ flexDirection: 'row', backgroundColor: colors.fill, borderRadius: 10, padding: 2, ...RADIUS }}>
                  {PREFERENCES.map((p) => {
                    const on = appearance.preference === p.value;
                    return (
                      <Pressable key={p.value} accessibilityRole="button" accessibilityLabel={`${p.label} appearance`} accessibilityState={{ selected: on }} onPress={() => appearance.setPreference(p.value)} style={{ width: 32, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? colors.card : 'transparent' }}>
                        <Ionicons name={APPEARANCE_ICON[p.value]} size={16} color={on ? colors.primary : colors.muted} />
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={{ height: 1, backgroundColor: colors.border }} />
              <Row icon="log-out-outline" label="Sign out" danger onPress={go(confirmSignOut)} />
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>
    </>
  );
}
