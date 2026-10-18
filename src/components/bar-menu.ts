import type { BarAction } from './bar-types';
import { showDialog } from './Dialogs';

// Opens a bar button's menu as the app's own sheet, on every platform. An entry with a menu of
// its own opens it as a second sheet.
export function openBarMenu(item: BarAction) {
  showDialog({
    kind: 'sheet',
    title: item.label,
    choices: (item.menu ?? []).map((entry) => ({
      label: entry.label,
      icon: entry.icon,
      destructive: entry.destructive,
      checked: entry.on,
      disabled: entry.disabled,
      onPress: entry.menu ? () => openBarMenu(entry) : entry.onPress,
    })),
  });
}
