// Native navigation bar buttons and bottom toolbar (system glass on iOS 26). Buttons with a menu
// open the app's own menu sheet, so menus look the same everywhere in the app.
import { Stack } from 'expo-router';

import { tap } from '../native-ui';
import { colors } from '../theme';
import { openBarMenu } from './bar-menu';
import type { BarAction, BarItem } from './bar-types';

function renderItem(item: BarItem, index: number) {
  if (item === 'space') {
    return <Stack.Toolbar.Spacer key={index} />;
  }
  if (item === 'search') {
    return <Stack.Toolbar.SearchBarSlot key={index} />;
  }
  return (
    <Stack.Toolbar.Button
      key={index}
      icon={item.icon}
      accessibilityLabel={item.label}
      variant={item.prominent ? 'prominent' : 'plain'}
      tintColor={item.destructive ? colors.danger : undefined}
      disabled={item.disabled}
      onPress={
        item.menu
          ? () => {
              tap();
              openBarMenu(item);
            }
          : item.onPress
      }
    />
  );
}

// The system toolbar adjusts scroll insets by itself, so screens need no extra padding for it.
export const bottomBarInset = 0;

export function HeaderBar({ side = 'right', items }: { side?: 'left' | 'right'; items: BarAction[] }) {
  return <Stack.Toolbar placement={side}>{items.map(renderItem)}</Stack.Toolbar>;
}

export function BottomBar({ items }: { items: BarItem[] }) {
  return <Stack.Toolbar placement="bottom">{items.map(renderItem)}</Stack.Toolbar>;
}
