import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { showDialog } from './components/Dialogs';
import type { IconName } from './components/Icon';

const isIOS = Platform.OS === 'ios';
const isDevice = Platform.OS !== 'web';

// How the device is named in texts shown to the user.
export const deviceName = isIOS ? 'iPhone' : 'phone';

// Text prompt for naming things.
export function promptText(title: string, initial: string, onSubmit: (value: string) => void) {
  showDialog({
    kind: 'prompt',
    title,
    initial,
    buttons: [
      { label: 'Cancel', style: 'cancel' },
      {
        label: 'Save',
        onPress: (value) => {
          if (value.trim()) {
            onSubmit(value.trim());
          }
        },
      },
    ],
  });
}

// Naming step shown right after a document is added: type a name, or save as-is to keep the
// suggestion. With onExpiry, a button saves the name and goes on to the expiry date; with
// onCancel, a Cancel button goes back (to the scan's pages).
export function promptName(
  suggestion: string,
  onDone: (name: string) => void,
  onExpiry?: (name: string) => void,
  onCancel?: () => void,
) {
  const name = (value: string) => value.trim() || suggestion;
  showDialog({
    kind: 'prompt',
    title: 'Name',
    message: `Leave empty to keep “${suggestion}”.`,
    buttons: [
      // Not the closing kind of cancel: tapping beside the pop-up does not leave this step.
      ...(onCancel ? [{ label: 'Cancel', style: 'secondary' as const, onPress: onCancel }] : []),
      ...(onExpiry ? [{ label: 'Set Expiry', style: 'secondary' as const, onPress: (value: string) => onExpiry(name(value)) }] : []),
      { label: 'Save', onPress: (value) => onDone(name(value)) },
    ],
  });
}

// Calendar for picking a day; the day comes back at midnight.
export function pickDate(title: string, initial: Date, onPick: (day: Date) => void, onCancel?: () => void) {
  showDialog({
    kind: 'date',
    title,
    initial,
    onCancel,
    onPick: (date) => {
      const day = new Date(date);
      day.setHours(0, 0, 0, 0);
      onPick(day);
    },
  });
}

// A year from tomorrow: the starting point for a new expiry date.
export function suggestedExpiry() {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + 1);
  day.setFullYear(day.getFullYear() + 1);
  return day;
}

// Prompt with a hidden text field, for passwords.
export function promptSecret(
  title: string,
  message: string | undefined,
  onSubmit: (value: string) => void,
  onCancel?: () => void,
) {
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
  confirm(title, message, 'Delete', onConfirm, { destructive: true, icon: 'trash' });
}

// A question with Cancel and one action.
export function confirm(
  title: string,
  message: string | undefined,
  action: string,
  onConfirm: () => void,
  options: { destructive?: boolean; icon?: IconName; onCancel?: () => void } = {},
) {
  showDialog({
    kind: 'confirm',
    title,
    message,
    icon: options.icon ?? (options.destructive ? 'exclamationmark.triangle.fill' : undefined),
    tone: options.destructive ? 'danger' : 'accent',
    buttons: [
      { label: 'Cancel', style: 'cancel', onPress: options.onCancel },
      { label: action, style: options.destructive ? 'destructive' : undefined, onPress: onConfirm },
    ],
  });
}

// A short message with a single button.
export function notify(title: string, message?: string, icon: IconName = 'info.circle') {
  showDialog({ kind: 'confirm', title, message, icon, tone: 'accent', buttons: [{ label: 'OK' }] });
}

export type Choice = {
  label: string;
  icon?: IconName;
  destructive?: boolean;
  onPress: () => void;
};

export function chooseOption(choices: Choice[], title?: string) {
  showDialog({ kind: 'sheet', title, choices });
}

export function showError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (!isDevice) {
    console.warn(message);
  }
  showDialog({
    kind: 'confirm',
    title: 'Something went wrong',
    message,
    icon: 'exclamationmark.triangle.fill',
    tone: 'warning',
    buttons: [{ label: 'OK' }],
  });
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
