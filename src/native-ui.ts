import * as Haptics from 'expo-haptics';
import { ActionSheetIOS, Alert, Platform } from 'react-native';

const isIOS = Platform.OS === 'ios';

// Native text prompt, as used by Notes and Files for naming things.
export function promptText(title: string, initial: string, onSubmit: (value: string) => void) {
  if (!isIOS) {
    const value = (globalThis as { prompt?: (message: string, initial: string) => string | null }).prompt?.(title, initial);
    if (value?.trim()) {
      onSubmit(value.trim());
    }
    return;
  }
  Alert.prompt(
    title,
    undefined,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Save',
        onPress: (value?: string) => {
          if (value?.trim()) {
            onSubmit(value.trim());
          }
        },
      },
    ],
    'plain-text',
    initial,
  );
}

export function confirmDelete(title: string, message: string | undefined, onConfirm: () => void) {
  if (!isIOS) {
    onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: onConfirm },
  ]);
}

export type Choice = {
  label: string;
  destructive?: boolean;
  onPress: () => void;
};

export function chooseOption(choices: Choice[], title?: string) {
  if (!isIOS) {
    return;
  }
  const destructiveButtonIndex = choices.findIndex((choice) => choice.destructive);
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title,
      options: [...choices.map((choice) => choice.label), 'Cancel'],
      cancelButtonIndex: choices.length,
      destructiveButtonIndex: destructiveButtonIndex >= 0 ? destructiveButtonIndex : undefined,
      userInterfaceStyle: 'dark',
    },
    (index) => {
      if (index < choices.length) {
        choices[index].onPress();
      }
    },
  );
}

export function showError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (isIOS) {
    Alert.alert('Something went wrong', message);
  } else {
    console.warn(message);
  }
}

export function tap() {
  if (isIOS) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

export function success() {
  if (isIOS) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }
}
