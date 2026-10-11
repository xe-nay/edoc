import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { Doc } from './types';

const DAY = 24 * 60 * 60 * 1000;

// Days before the expiry date on which a reminder fires (at 09:00).
const LEAD_DAYS = [30, 5, 0];

// A document this close to its expiry date is shown at the top of the home screen.
export const URGENT_DAYS = 5;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('default', {
    name: 'Expiry reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
  }).catch(() => {});
}

export async function ensureReminderPermission() {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) {
    return true;
  }
  if (!current.canAskAgain) {
    return false;
  }
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

export async function cancelReminders(ids: string[]) {
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
}

// Document names are deliberately left out: reminders show on the lock screen.
function reminderBody(lead: number) {
  if (lead === 0) {
    return 'A document expires today';
  }
  return `A document expires in ${lead} days`;
}

// Replaces the reminders of a document and returns the new notification ids.
// With ask set to false nothing is scheduled unless notifications were already allowed.
export async function scheduleReminders(
  doc: Pick<Doc, 'id' | 'reminderIds'>,
  expiresAt: number | null,
  ask = true,
) {
  await cancelReminders(doc.reminderIds);
  if (expiresAt === null) {
    return [];
  }
  const allowed = ask ? await ensureReminderPermission() : (await Notifications.getPermissionsAsync()).granted;
  if (!allowed) {
    return [];
  }
  const ids: string[] = [];
  for (const lead of LEAD_DAYS) {
    const when = new Date(expiresAt - lead * DAY);
    when.setHours(9, 0, 0, 0);
    if (when.getTime() <= Date.now()) {
      continue;
    }
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'eDoc',
        body: reminderBody(lead),
        data: { docId: doc.id },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
    });
    ids.push(id);
  }
  return ids;
}
