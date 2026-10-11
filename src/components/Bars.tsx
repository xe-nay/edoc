// Native navigation bar buttons and bottom toolbar (system glass on iOS 26).
import { Stack } from 'expo-router';

import { colors } from '../theme';
import type { BarAction, BarItem } from './bar-types';

function renderMenuEntry(entry: BarAction, index: number) {
  if (entry.menu) {
    return (
      <Stack.Toolbar.Menu key={index} icon={entry.icon} title={entry.label}>
        {entry.menu.map(renderMenuEntry)}
      </Stack.Toolbar.Menu>
    );
  }
  return (
    <Stack.Toolbar.MenuAction
      key={index}
      icon={entry.icon}
      destructive={entry.destructive}
      disabled={entry.disabled}
      isOn={entry.on}
      onPress={entry.onPress}>
      {entry.label}
    </Stack.Toolbar.MenuAction>
  );
}

function renderItem(item: BarItem, index: number) {
  if (item === 'space') {
    return <Stack.Toolbar.Spacer key={index} />;
  }
  if (item === 'search') {
    return <Stack.Toolbar.SearchBarSlot key={index} />;
  }
  if (item.menu) {
    return (
      <Stack.Toolbar.Menu key={index} icon={item.icon} accessibilityLabel={item.label}>
        {item.menu.map(renderMenuEntry)}
      </Stack.Toolbar.Menu>
    );
  }
  return (
    <Stack.Toolbar.Button
      key={index}
      icon={item.icon}
      accessibilityLabel={item.label}
      variant={item.prominent ? 'prominent' : 'plain'}
      tintColor={item.destructive ? colors.danger : undefined}
      disabled={item.disabled}
      onPress={item.onPress}
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
