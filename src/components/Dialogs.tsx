// The app's own pop-ups: option sheets, text prompts and confirmations, drawn in eDoc's style on
// every platform. They arrive with a short spring and leave quickly; nothing bounces for long.
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, withAlpha } from '../theme';
import { Icon, type IconName } from './Icon';

export type DialogButton = {
  label: string;
  // "cancel" is the quiet button that closing also presses; "secondary" looks quiet but is an
  // action of its own; "destructive" is the red main button; anything else is the blue main button.
  style?: 'cancel' | 'secondary' | 'destructive';
  onPress?: (value: string) => void;
};

export type PromptRequest = {
  kind: 'prompt';
  title: string;
  message?: string;
  initial?: string;
  secure?: boolean;
  buttons: DialogButton[];
};

export type ConfirmRequest = {
  kind: 'confirm';
  title: string;
  message?: string;
  icon?: IconName;
  tone?: 'danger' | 'warning' | 'accent';
  buttons: DialogButton[];
};

export type SheetChoice = {
  label: string;
  icon?: IconName;
  destructive?: boolean;
  checked?: boolean;
  disabled?: boolean;
  onPress?: () => void;
};

export type SheetRequest = {
  kind: 'sheet';
  title?: string;
  choices: SheetChoice[];
};

export type DateRequest = {
  kind: 'date';
  title: string;
  initial: Date;
  onPick: (date: Date) => void;
  onCancel?: () => void;
};

type Request = PromptRequest | ConfirmRequest | SheetRequest | DateRequest;

let present: ((request: Request) => void) | null = null;

export function showDialog(request: Request) {
  present?.(request);
}

const SHEET_MAX_WIDTH = 520;
const CARD_MAX_WIDTH = 400;
const surface = '#0A1328';
const tones = { danger: colors.danger, warning: colors.warning, accent: colors.accentSoft };

export function DialogHost() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [request, setRequest] = useState<Request | null>(null);
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const input = useRef<TextInput>(null);
  const backdrop = useRef(new Animated.Value(0)).current;
  const appear = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);

  useEffect(() => {
    present = (next) => {
      closing.current = false;
      setValue(next.kind === 'prompt' ? (next.initial ?? '') : '');
      setRequest(next);
      backdrop.setValue(0);
      appear.setValue(0);
      Animated.parallel([
        Animated.timing(backdrop, { toValue: 1, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.spring(appear, { toValue: 1, damping: 22, stiffness: 260, mass: 0.9, useNativeDriver: true }),
      ]).start();
    };
    return () => {
      present = null;
    };
  }, [backdrop, appear]);

  if (!request) {
    return null;
  }

  // The pop-up leaves first, then the action runs, so an action can open the next pop-up.
  const finish = (action?: () => void) => {
    if (closing.current) {
      return;
    }
    closing.current = true;
    Animated.parallel([
      Animated.timing(backdrop, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(appear, { toValue: 0, duration: 150, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start(() => {
      setRequest(null);
      setFocused(false);
      if (action) {
        setTimeout(action, 30);
      }
    });
  };

  const cancel = () => {
    if (request.kind === 'sheet') {
      finish();
      return;
    }
    if (request.kind === 'date') {
      finish(request.onCancel);
      return;
    }
    const button = request.buttons.find((item) => item.style === 'cancel');
    if (!button) {
      // A message with a single button closes like pressing it; a required prompt stays open.
      if (request.kind === 'confirm' && request.buttons.length === 1) {
        finish(() => request.buttons[0].onPress?.(''));
      }
      return;
    }
    finish(() => button.onPress?.(value));
  };

  const shade = (
    <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdrop }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={cancel} accessibilityLabel="Close" />
    </Animated.View>
  );

  if (request.kind === 'sheet') {
    // On a tablet the sheet keeps a phone-like width, centred at the bottom.
    const sheetWidth = Math.min(width - 20, SHEET_MAX_WIDTH);
    const rise = {
      opacity: appear,
      transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [48, 0] }) }],
    };
    return (
      <Modal transparent visible statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={cancel}>
        {shade}
        <View pointerEvents="box-none" style={[styles.sheetArea, { paddingBottom: insets.bottom + 10 }]}>
          <Animated.View style={[styles.sheet, { width: sheetWidth }, rise]}>
            <LinearGradient
              colors={[withAlpha(colors.accent, 0.16), withAlpha(colors.accent, 0)]}
              style={styles.glow}
              pointerEvents="none"
            />
            <View style={styles.grabber} />
            {request.title ? (
              <Text numberOfLines={1} style={styles.sheetTitle}>
                {request.title}
              </Text>
            ) : null}
            {request.choices.map((choice, index) => {
              const tint = choice.destructive ? colors.danger : colors.text;
              // Rows settle in one after another, a few milliseconds apart.
              const start = Math.min(0.25 + index * 0.07, 0.8);
              const row = {
                opacity: appear.interpolate({ inputRange: [0, start, 1], outputRange: [0, 0, 1], extrapolate: 'clamp' }),
                transform: [
                  {
                    translateY: appear.interpolate({ inputRange: [0, start, 1], outputRange: [10, 10, 0], extrapolate: 'clamp' }),
                  },
                ],
              };
              return (
                <Animated.View key={index} style={row}>
                  <Pressable
                    disabled={choice.disabled}
                    onPress={() => finish(choice.onPress)}
                    style={({ pressed }) => [styles.choice, choice.disabled && { opacity: 0.35 }, pressed && styles.pressed]}>
                    <View
                      style={[
                        styles.choiceIcon,
                        { backgroundColor: withAlpha(choice.destructive ? colors.danger : colors.accent, 0.15) },
                      ]}>
                      <Icon
                        name={choice.icon ?? 'circle'}
                        size={17}
                        color={choice.destructive ? colors.danger : colors.accentSoft}
                        weight="semibold"
                      />
                    </View>
                    <Text style={[styles.choiceText, { color: tint }]} numberOfLines={1}>
                      {choice.label}
                    </Text>
                    {choice.checked ? <Icon name="checkmark" size={16} color={colors.accentSoft} weight="bold" /> : null}
                  </Pressable>
                </Animated.View>
              );
            })}
          </Animated.View>
          <Animated.View style={[{ width: sheetWidth }, rise]}>
            <Pressable onPress={cancel} style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </Animated.View>
        </View>
      </Modal>
    );
  }

  const cardWidth = Math.min(width - 40, CARD_MAX_WIDTH);
  const pop = {
    opacity: appear,
    transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }],
  };

  if (request.kind === 'date') {
    return (
      <Modal transparent visible statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={cancel}>
        {shade}
        <View pointerEvents="box-none" style={styles.centred}>
          <Animated.View style={[styles.card, { width: cardWidth }, pop]}>
            <LinearGradient
              colors={[withAlpha(colors.accent, 0.14), withAlpha(colors.accent, 0)]}
              style={styles.glow}
              pointerEvents="none"
            />
            <Text style={styles.cardTitle}>{request.title}</Text>
            <Calendar
              initial={request.initial}
              onCancel={cancel}
              onPick={(date) => finish(() => request.onPick(date))}
            />
          </Animated.View>
        </View>
      </Modal>
    );
  }
  const tone = request.kind === 'confirm' ? tones[request.tone ?? 'accent'] : colors.accentSoft;
  const main = request.buttons.find((button) => button.style !== 'cancel');

  return (
    <Modal
      transparent
      visible
      statusBarTranslucent
      navigationBarTranslucent
      animationType="none"
      onRequestClose={cancel}
      onShow={() => {
        if (request.kind === 'prompt') {
          setTimeout(() => input.current?.focus(), 120);
        }
      }}>
      {shade}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        pointerEvents="box-none"
        style={styles.centred}>
        <Animated.View style={[styles.card, { width: cardWidth }, pop]}>
          <LinearGradient colors={[withAlpha(tone, 0.14), withAlpha(tone, 0)]} style={styles.glow} pointerEvents="none" />
          {request.kind === 'confirm' && request.icon ? (
            <View style={[styles.badge, { backgroundColor: withAlpha(tone, 0.16), borderColor: withAlpha(tone, 0.35) }]}>
              <Icon name={request.icon} size={22} color={tone} weight="semibold" />
            </View>
          ) : null}
          <Text style={[styles.cardTitle, request.kind === 'confirm' && styles.centreText]}>{request.title}</Text>
          {request.message ? (
            <Text style={[styles.cardMessage, request.kind === 'confirm' && styles.centreText]}>{request.message}</Text>
          ) : null}
          {request.kind === 'prompt' ? (
            <TextInput
              ref={input}
              value={value}
              onChangeText={setValue}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              secureTextEntry={request.secure}
              autoCapitalize={request.secure ? 'none' : 'sentences'}
              autoCorrect={false}
              selectionColor={colors.accent}
              keyboardAppearance="dark"
              returnKeyType="done"
              onSubmitEditing={() => {
                if (main) finish(() => main.onPress?.(value));
              }}
              style={[styles.input, focused && styles.inputFocused]}
            />
          ) : null}
          <View style={styles.buttons}>
            {request.buttons.map((button, index) => {
              const quiet = button.style === 'cancel' || button.style === 'secondary';
              const danger = button.style === 'destructive';
              return (
                <Pressable
                  key={index}
                  onPress={() => finish(() => button.onPress?.(value))}
                  style={({ pressed }) => [
                    styles.button,
                    quiet && styles.buttonQuiet,
                    pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] },
                  ]}>
                  {quiet ? null : (
                    <LinearGradient
                      colors={danger ? ['#FF6B7E', '#E3445A'] : ['#5A8FFF', '#2F6BFF']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFill}
                    />
                  )}
                  <Text style={[styles.buttonText, quiet && styles.buttonTextQuiet]}>{button.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const SHORTCUTS: { label: string; months: number }[] = [
  { label: '1 month', months: 1 },
  { label: '6 months', months: 6 },
  { label: '1 year', months: 12 },
  { label: '5 years', months: 60 },
];

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// A month at a time, weeks starting on Monday, with shortcuts for common lengths of validity.
function Calendar({ initial, onPick, onCancel }: { initial: Date; onPick: (date: Date) => void; onCancel: () => void }) {
  const [selected, setSelected] = useState(initial);
  const [month, setMonth] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1));
  const fade = useRef(new Animated.Value(1)).current;
  const today = new Date();

  const show = (next: Date) => {
    fade.setValue(0.25);
    setMonth(new Date(next.getFullYear(), next.getMonth(), 1));
    Animated.timing(fade, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  };

  const lead = (month.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1)),
  ];
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  const title = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <View>
      <View style={styles.monthBar}>
        <Pressable
          accessibilityLabel="Previous month"
          hitSlop={8}
          onPress={() => show(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          style={({ pressed }) => [styles.monthArrow, pressed && styles.pressed]}>
          <Icon name="chevron.left" size={15} color={colors.text} weight="semibold" />
        </Pressable>
        <Text style={styles.monthTitle}>{title}</Text>
        <Pressable
          accessibilityLabel="Next month"
          hitSlop={8}
          onPress={() => show(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          style={({ pressed }) => [styles.monthArrow, pressed && styles.pressed]}>
          <Icon name="chevron.right" size={15} color={colors.text} weight="semibold" />
        </Pressable>
      </View>
      <View style={styles.week}>
        {WEEKDAYS.map((day, index) => (
          <Text key={index} style={styles.weekday}>
            {day}
          </Text>
        ))}
      </View>
      <Animated.View style={{ opacity: fade }}>
        {Array.from({ length: cells.length / 7 }, (_, row) => (
          <View key={row} style={styles.week}>
            {cells.slice(row * 7, row * 7 + 7).map((day, index) => {
              if (!day) {
                return <View key={index} style={styles.day} />;
              }
              const isSelected = sameDay(day, selected);
              const isToday = sameDay(day, today);
              return (
                <Pressable key={index} onPress={() => setSelected(day)} style={styles.day}>
                  {isSelected ? (
                    <LinearGradient colors={['#5A8FFF', '#2F6BFF']} style={styles.dayMark} />
                  ) : isToday ? (
                    <View style={[styles.dayMark, styles.todayMark]} />
                  ) : null}
                  <Text style={[styles.dayText, isSelected && styles.dayTextSelected, isToday && !isSelected && { color: colors.accentSoft }]}>
                    {day.getDate()}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </Animated.View>
      <View style={styles.shortcuts}>
        {SHORTCUTS.map((shortcut) => (
          <Pressable
            key={shortcut.label}
            onPress={() => {
              const next = new Date(today.getFullYear(), today.getMonth() + shortcut.months, today.getDate());
              setSelected(next);
              show(next);
            }}
            style={({ pressed }) => [styles.shortcut, pressed && styles.pressed]}>
            <Text style={styles.shortcutText}>{shortcut.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.buttons}>
        <Pressable onPress={onCancel} style={({ pressed }) => [styles.button, styles.buttonQuiet, pressed && { opacity: 0.8 }]}>
          <Text style={[styles.buttonText, styles.buttonTextQuiet]}>Cancel</Text>
        </Pressable>
        <Pressable onPress={() => onPick(selected)} style={({ pressed }) => [styles.button, pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] }]}>
          <LinearGradient colors={['#5A8FFF', '#2F6BFF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <Text style={styles.buttonText}>Set</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 10,
  },
  monthArrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  monthTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
    textTransform: 'capitalize',
  },
  week: {
    flexDirection: 'row',
  },
  weekday: {
    flex: 1,
    textAlign: 'center',
    color: colors.textFaint,
    fontSize: 12,
    fontWeight: '700',
    paddingVertical: 6,
  },
  day: {
    flex: 1,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayMark: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  todayMark: {
    borderWidth: 1,
    borderColor: withAlpha(colors.accentSoft, 0.7),
  },
  dayText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  dayTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  shortcuts: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 12,
  },
  shortcut: {
    flex: 1,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  shortcutText: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: '600',
  },
  backdrop: {
    backgroundColor: 'rgba(1, 4, 12, 0.72)',
  },
  pressed: {
    backgroundColor: colors.glassStrong,
  },
  sheetArea: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
  },
  sheet: {
    borderRadius: 28,
    borderCurve: 'continuous',
    backgroundColor: surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairlineStrong,
    overflow: 'hidden',
    paddingBottom: 6,
  },
  glow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 120,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginTop: 8,
    marginBottom: 4,
    backgroundColor: colors.hairlineStrong,
  },
  sheetTitle: {
    color: colors.textFaint,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    textAlign: 'center',
    paddingTop: 8,
    paddingBottom: 6,
    paddingHorizontal: 24,
  },
  choice: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginHorizontal: 8,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderCurve: 'continuous',
  },
  choiceIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: -0.2,
  },
  cancel: {
    height: 54,
    borderRadius: 22,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairlineStrong,
  },
  cancelText: {
    color: colors.accentSoft,
    fontSize: 16,
    fontWeight: '600',
  },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderRadius: 28,
    borderCurve: 'continuous',
    backgroundColor: surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairlineStrong,
    padding: 22,
    overflow: 'hidden',
  },
  badge: {
    alignSelf: 'center',
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  centreText: {
    textAlign: 'center',
  },
  cardMessage: {
    color: colors.textDim,
    fontSize: 14.5,
    lineHeight: 20,
    marginTop: 6,
  },
  input: {
    marginTop: 18,
    height: 50,
    borderRadius: 15,
    borderCurve: 'continuous',
    paddingHorizontal: 15,
    color: colors.text,
    fontSize: 16,
    backgroundColor: colors.glassStrong,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  inputFocused: {
    borderColor: withAlpha(colors.accent, 0.8),
    backgroundColor: withAlpha(colors.accent, 0.1),
  },
  buttons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 22,
  },
  button: {
    flex: 1,
    height: 48,
    borderRadius: 16,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  buttonQuiet: {
    backgroundColor: colors.glassStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairlineStrong,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  buttonTextQuiet: {
    color: colors.textDim,
    fontWeight: '600',
  },
});
