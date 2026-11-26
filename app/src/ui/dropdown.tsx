import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View, useWindowDimensions, type TextInputInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tap } from '@/ui/motion';
import { colors } from '@/ui/colors';

export interface DropdownOption {
  value: string;
  label: string;
}

const ROW = 50;
/** Lists up to this long drop down right under the field; longer ones open as a searchable sheet. */
const POPOVER_MAX = 7;
const SEARCH_ABOVE = 12;

/** What a view can tell us about where it is on screen. */
interface Measurable {
  measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A dropdown that suits the size of the list. A short list (gender, status, title) drops down right under the
 * field, so the choice is one tap away and the form stays in view. A long list (region, relationship) opens as a
 * sheet with search that scrolls to the current choice. Both mark the chosen option, give a tap of feedback,
 * close on a tap outside, and keep the keyboard out of the way.
 */
export function Dropdown(props: {
  label: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  required?: boolean;
  error?: string | null;
  help?: string;
  placeholder?: string;
  disabled?: boolean;
  /** The label shown above the field. */
  renderLabel?: (label: string, required?: boolean) => React.ReactNode;
}) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const trigger = useRef<Measurable | null>(null);
  const searchRef = useRef<TextInputInstance>(null);
  const list = useRef<FlatList<DropdownOption>>(null);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<Box | null>(null);
  const [filter, setFilter] = useState('');
  const appear = useRef(new Animated.Value(0)).current;

  const current = props.options.find((o) => o.value === props.value);
  const popover = props.options.length <= POPOVER_MAX;
  const searchable = props.options.length > SEARCH_ABOVE;
  const canClear = props.value !== '' && !props.required;

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? props.options.filter((o) => o.label.toLowerCase().includes(f)) : props.options;
  }, [filter, props.options]);

  useEffect(() => {
    if (!open) return;
    appear.setValue(0);
    Animated.timing(appear, { toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [open, appear]);

  const show = () => {
    if (props.disabled) return;
    tap('light');
    // Opens where the field is. If the phone cannot say where that is, it opens anyway, centred, rather than not at all.
    let opened = false;
    const openAt = (b: Box) => {
      if (opened) return;
      opened = true;
      setBox(b);
      setOpen(true);
    };
    trigger.current?.measureInWindow((x, y, width, height) => openAt({ x, y, width, height }));
    setTimeout(() => openAt({ x: 16, y: Math.round(screenH / 3), width: screenW - 32, height: 52 }), 120);
  };
  const close = () => {
    Animated.timing(appear, { toValue: 0, duration: 120, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => {
      setOpen(false);
      setFilter('');
    });
  };
  const choose = (value: string) => {
    tap('light');
    props.onChange(value);
    close();
  };

  const selectedIndex = shown.findIndex((o) => o.value === props.value);

  const row = (item: DropdownOption) => {
    const on = item.value === props.value;
    return (
      <Pressable
        key={item.value}
        accessibilityRole="menuitem"
        accessibilityState={{ selected: on }}
        onPress={() => choose(item.value)}
        style={({ pressed }) => ({ height: ROW, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: pressed ? colors.pressed : on ? colors.primarySoft : 'transparent' })}
      >
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, color: on ? colors.primaryDeep : colors.text, fontWeight: on ? '700' : '400' }}>{item.label}</Text>
        {on ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
      </Pressable>
    );
  };

  const clearRow = canClear ? (
    <Pressable accessibilityRole="button" onPress={() => choose('')} style={({ pressed }) => ({ height: ROW, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: pressed ? colors.pressed : 'transparent', borderTopWidth: 1, borderTopColor: colors.border })}>
      <Ionicons name="close-circle-outline" size={20} color={colors.danger} />
      <Text style={{ fontSize: 15, color: colors.danger, fontWeight: '600' }}>Clear choice</Text>
    </Pressable>
  ) : null;

  // ---- where the popover sits ----
  const panelH = Math.min(props.options.length * ROW + (canClear ? ROW : 0) + 8, 360);
  const roomBelow = box ? screenH - insets.bottom - (box.y + box.height) - 12 : 0;
  const above = box ? roomBelow < panelH && box.y - insets.top > roomBelow : false;
  const popTop = box ? (above ? Math.max(insets.top + 8, box.y - 6 - panelH) : box.y + box.height + 6) : 0;

  return (
    <View style={{ marginBottom: 14 }}>
      {props.renderLabel ? props.renderLabel(props.label, props.required) : null}
      <View ref={(el) => { trigger.current = el as unknown as Measurable | null; }} collapsable={false}>
        <Pressable
          accessibilityRole="combobox"
          accessibilityLabel={props.label}
          accessibilityState={{ expanded: open, disabled: !!props.disabled }}
          disabled={props.disabled}
          onPress={show}
          style={({ pressed }) => ({
            minHeight: 52,
            borderWidth: 1.5,
            borderColor: props.error ? colors.danger : open ? colors.primary : colors.fill,
            borderRadius: 14,
            borderCurve: 'continuous',
            paddingHorizontal: 14,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: open ? colors.card : colors.fill,
            opacity: props.disabled ? 0.5 : pressed ? 0.85 : 1,
          })}
        >
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, color: current ? colors.text : colors.muted }}>
            {current ? current.label : props.placeholder ?? 'Choose'}
          </Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={open ? colors.primary : colors.muted} />
        </Pressable>
      </View>
      {props.error ? <Text style={{ color: colors.danger, fontSize: 12, marginTop: 6 }}>{props.error}</Text> : props.help ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>{props.help}</Text> : null}

      <Modal visible={open} transparent animationType="none" statusBarTranslucent onRequestClose={close}>
        {popover && box ? (
          <Pressable accessibilityLabel="Close" style={{ flex: 1 }} onPress={close}>
            <Animated.View
              style={{
                position: 'absolute',
                left: Math.min(Math.max(8, box.x), screenW - box.width - 8),
                top: popTop,
                width: box.width,
                opacity: appear,
                // Grows out of the field it belongs to.
                transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [above ? 8 : -8, 0] }) }, { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }],
              }}
            >
              <Pressable onPress={() => undefined} style={{ backgroundColor: colors.card, borderRadius: 16, borderCurve: 'continuous', overflow: 'hidden', paddingVertical: 4, borderWidth: 1, borderColor: colors.border, boxShadow: '0 12px 32px rgba(0, 0, 0, 0.22)' }}>
                {props.options.map(row)}
                {clearRow}
              </Pressable>
            </Animated.View>
          </Pressable>
        ) : (
          <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Animated.View style={{ ...{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, backgroundColor: colors.scrim, opacity: appear }}>
              <Pressable accessibilityLabel="Close" style={{ flex: 1 }} onPress={close} />
            </Animated.View>
            <Animated.View
              style={{
                maxHeight: screenH * 0.7,
                backgroundColor: colors.card,
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                borderCurve: 'continuous',
                paddingTop: 10,
                paddingBottom: insets.bottom + 8,
                opacity: appear,
                transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) }],
              }}
            >
              <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.grabber, marginBottom: 10 }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 10 }}>
                <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text, letterSpacing: -0.2 }}>{props.label}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} hitSlop={10}>
                  <Ionicons name="close" size={22} color={colors.muted} />
                </Pressable>
              </View>
              {searchable ? (
                <View style={{ marginHorizontal: 16, marginBottom: 6, minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.fill }}>
                  <Ionicons name="search" size={18} color={colors.muted} />
                  <TextInput ref={searchRef} value={filter} onChangeText={setFilter} placeholder={`Search ${props.options.length} options`} placeholderTextColor={colors.muted} autoCorrect={false} autoCapitalize="none" returnKeyType="done" style={{ flex: 1, color: colors.text, fontSize: 15, minHeight: 44 }} />
                  {filter ? (
                    <Pressable accessibilityLabel="Clear search" onPress={() => setFilter('')} hitSlop={8}>
                      <Ionicons name="close-circle" size={18} color={colors.faint} />
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              <FlatList
                ref={list}
                data={shown}
                keyExtractor={(o) => o.value}
                keyboardShouldPersistTaps="handled"
                getItemLayout={(_, index) => ({ length: ROW, offset: ROW * index, index })}
                // Opens already scrolled to the current choice, a little from the top so its neighbours show.
                initialScrollIndex={!filter && selectedIndex > 2 ? selectedIndex - 2 : undefined}
                renderItem={({ item }) => row(item)}
                ListEmptyComponent={
                  <View style={{ padding: 28, alignItems: 'center', gap: 6 }}>
                    <Ionicons name="search-outline" size={28} color={colors.faint} />
                    <Text style={{ color: colors.muted }}>Nothing matches “{filter}”</Text>
                  </View>
                }
                ListFooterComponent={clearRow ?? undefined}
              />
            </Animated.View>
          </KeyboardAvoidingView>
        )}
      </Modal>
    </View>
  );
}
