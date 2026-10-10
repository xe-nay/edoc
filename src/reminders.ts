import * as Notifications from 'expo-notifications';

import type { Doc } from './types';

const DAY = 24 * 60 * 60 * 1000;

// Days before the expiry date on which a reminder fires (at 09:00).
const LEAD_DAYS = [30, 7, 0];

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

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

function reminderBody(lead: number) {
  if (lead === 0) {
    return 'Expires today';
  }
  return `Expires in ${lead} days`;
}

// Replaces the reminders of a document and returns the new notification ids.
export async function scheduleReminders(doc: Pick<Doc, 'id' | 'name' | 'reminderIds'>, expiresAt: number | null) {
  await cancelReminders(doc.reminderIds);
  if (expiresAt === null || !(await ensureReminderPermission())) {
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
        title: doc.name,
        body: reminderBody(lead),
        data: { docId: doc.id },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
    });
    ids.push(id);
  }
  return ids;
}
