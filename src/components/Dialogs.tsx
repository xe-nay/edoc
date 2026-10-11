// In-app text prompt and option sheet. iOS uses the system ones; these stand in on
// Android (and in the browser preview), drawn in the app's own style.
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, space, withAlpha } from '../theme';
import { Icon, type IconName } from './Icon';

export type DialogButton = {
  label: string;
  style?: 'cancel' | 'destructive';
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

type Request = PromptRequest | SheetRequest;

let present: ((request: Request) => void) | null = null;

export function showDialog(request: Request) {
  present?.(request);
}

export function DialogHost() {
  const insets = useSafeAreaInsets();
  const [request, setRequest] = useState<Request | null>(null);
  const [value, setValue] = useState('');
  const input = useRef<TextInput>(null);

  useEffect(() => {
    present = (next) => {
      setValue(next.kind === 'prompt' ? (next.initial ?? '') : '');
      setRequest(next);
    };
    return () => {
      present = null;
    };
  }, []);

  if (!request) {
    return null;
  }

  // The dialog closes first, then the action runs, so an action can open the next dialog.
  const finish = (action?: () => void) => {
    setRequest(null);
    if (action) {
      setTimeout(action, 60);
    }
  };

  const cancel = () => {
    if (request.kind === 'prompt') {
      const button = request.buttons.find((item) => item.style === 'cancel');
      // A prompt without a cancel button is a required step and stays open.
      if (!button) {
        return;
      }
      finish(() => button.onPress?.(value));
    } else {
      finish();
    }
  };

  if (request.kind === 'sheet') {
    return (
      <Modal transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={cancel}>
        <Pressable style={styles.backdrop} onPress={cancel}>
          <Pressable style={[styles.sheet, { marginBottom: insets.bottom + 12 }]} onPress={() => {}}>
            {request.title ? (
              <Text numberOfLines={1} style={styles.sheetTitle}>
                {request.title}
              </Text>
            ) : null}
            {request.choices.map((choice, index) => {
              const tint = choice.destructive ? colors.danger : colors.text;
              return (
                <Pressable
                  key={index}
                  disabled={choice.disabled}
                  android_ripple={{ color: withAlpha(colors.accentSoft, 0.14) }}
                  onPress={() => finish(choice.onPress)}
                  style={[styles.choice, index > 0 && styles.divider, choice.disabled && { opacity: 0.35 }]}>
                  {choice.icon ? <Icon name={choice.icon} size={19} color={tint} /> : null}
                  <Text style={[styles.choiceText, { color: tint }]}>{choice.label}</Text>
                  {choice.checked ? <Icon name="checkmark" size={16} color={colors.accentSoft} weight="semibold" /> : null}
                </Pressable>
              );
            })}
          </Pressable>
          <Pressable style={[styles.sheet, styles.cancel, { marginBottom: insets.bottom + 12 }]} onPress={cancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  return (
    <Modal
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="fade"
      onRequestClose={cancel}
      onShow={() => setTimeout(() => input.current?.focus(), 80)}>
      <KeyboardAvoidingView behavior="padding" style={[styles.backdrop, styles.centered]}>
        <View style={styles.prompt}>
          <Text style={styles.promptTitle}>{request.title}</Text>
          {request.message ? <Text style={styles.promptMessage}>{request.message}</Text> : null}
          <TextInput
            ref={input}
            value={value}
            onChangeText={setValue}
            secureTextEntry={request.secure}
            autoCapitalize={request.secure ? 'none' : 'sentences'}
            autoCorrect={false}
            selectionColor={colors.accent}
            style={styles.input}
          />
          <View style={styles.buttons}>
            {request.buttons.map((button, index) => (
              <Pressable
                key={index}
                hitSlop={6}
                onPress={() => finish(() => button.onPress?.(value))}
                style={({ pressed }) => [styles.button, pressed && { opacity: 0.6 }]}>
                <Text
                  style={[
                    styles.buttonText,
                    button.style === 'cancel' && { color: colors.textDim, fontWeight: '500' },
                    button.style === 'destructive' && { color: colors.danger },
                  ]}>
                  {button.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  centered: {
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  sheet: {
    marginHorizontal: 12,
    borderRadius: radius.lg,
    backgroundColor: '#0C1730',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairlineStrong,
    overflow: 'hidden',
  },
  sheetTitle: {
    color: colors.textFaint,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 12,
    paddingHorizontal: space.md,
  },
  choice: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  choiceText: {
    flex: 1,
    fontSize: 16,
  },
  cancel: {
    marginTop: 8,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    color: colors.accentSoft,
    fontSize: 16,
    fontWeight: '600',
  },
  prompt: {
    borderRadius: radius.lg,
    backgroundColor: '#0C1730',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairlineStrong,
    padding: 20,
  },
  promptTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  promptMessage: {
    color: colors.textDim,
    fontSize: 14,
    lineHeight: 19,
    marginTop: 6,
  },
  input: {
    marginTop: 16,
    height: 46,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    color: colors.text,
    fontSize: 16,
    backgroundColor: colors.glassStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairlineStrong,
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 22,
    marginTop: 18,
  },
  button: {
    paddingVertical: 6,
  },
  buttonText: {
    color: colors.accentSoft,
    fontSize: 16,
    fontWeight: '700',
  },
});
