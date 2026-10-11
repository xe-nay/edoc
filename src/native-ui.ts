import * as Haptics from 'expo-haptics';
import { ActionSheetIOS, Alert, Platform } from 'react-native';

import { showDialog } from './components/Dialogs';

const isIOS = Platform.OS === 'ios';
const isDevice = Platform.OS !== 'web';

// How the device is named in texts shown to the user.
export const deviceName = isIOS ? 'iPhone' : 'phone';

// Text prompt for naming things: the system one on iOS, the in-app one elsewhere.
export function promptText(title: string, initial: string, onSubmit: (value: string) => void) {
  const submit = (value?: string) => {
    if (value?.trim()) {
      onSubmit(value.trim());
    }
  };
  if (isIOS) {
    Alert.prompt(
      title,
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save', onPress: submit },
      ],
      'plain-text',
      initial,
    );
    return;
  }
  showDialog({
    kind: 'prompt',
    title,
    initial,
    buttons: [
      { label: 'Cancel', style: 'cancel' },
      { label: 'Save', onPress: submit },
    ],
  });
}

// Naming step shown right after a document is added: type a name, or save as-is to keep the suggestion.
export function promptName(suggestion: string, onDone: (name: string) => void) {
  const message = `Leave empty to keep “${suggestion}”.`;
  const done = (value?: string) => onDone(value?.trim() || suggestion);
  if (isIOS) {
    Alert.prompt('Name', message, [{ text: 'Save', onPress: done }], 'plain-text');
    return;
  }
  showDialog({ kind: 'prompt', title: 'Name', message, buttons: [{ label: 'Save', onPress: done }] });
}

// Prompt with a hidden text field, for backup passwords.
export function promptSecret(
  title: string,
  message: string | undefined,
  onSubmit: (value: string) => void,
  onCancel?: () => void,
) {
  if (isIOS) {
    Alert.prompt(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: onCancel },
        { text: 'Continue', onPress: (value?: string) => onSubmit(value ?? '') },
      ],
      'secure-text',
    );
    return;
  }
  showDialog({
    kind: 'prompt',
    title,
    message,
    secure: true,
    buttons: [
      { label: 'Cancel', style: 'cancel', onPress: onCancel },
      { label: 'Continue', onPress: onSubmit },
    ],
  });
}

export function confirmDelete(title: string, message: string | undefined, onConfirm: () => void) {
  if (!isDevice) {
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
    showDialog({ kind: 'sheet', title, choices });
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
  if (isDevice) {
    Alert.alert('Something went wrong', message);
  } else {
    console.warn(message);
  }
}

export function tap() {
  if (isDevice) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }
}

export function success() {
  if (isDevice) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }
}
