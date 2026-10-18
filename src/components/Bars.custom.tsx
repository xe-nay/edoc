// Navigation bar buttons and bottom toolbar drawn by the app itself. Used on Android (and in the
// browser preview), where the system does not provide iOS-style glass bars.
import { Stack } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../theme';
import { openBarMenu as openMenu } from './bar-menu';
import type { BarAction, BarItem } from './bar-types';
import { Icon } from './Icon';

function Button({ item, compact, tight }: { item: BarAction; compact?: boolean; tight?: boolean }) {
  const tint = item.destructive ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityLabel={item.label}
      disabled={item.disabled}
      hitSlop={compact ? 6 : 0}
      onPress={() => (item.menu ? openMenu(item) : item.onPress?.())}
      style={({ pressed }) => [
        compact ? styles.headerButton : styles.button,
        tight && styles.tight,
        item.prominent && styles.prominent,
        item.disabled && { opacity: 0.35 },
        pressed && { opacity: 0.6 },
      ]}>
      {item.icon ? <Icon name={item.icon} size={21} color={tint} /> : <Text style={styles.label}>{item.label}</Text>}
    </Pressable>
  );
}

export function HeaderBar({ side = 'right', items }: { side?: 'left' | 'right'; items: BarAction[] }) {
  const render = () => (
    <View style={styles.header}>
      {items.map((item, index) => (
        <Button key={index} item={item} compact />
      ))}
    </View>
  );
  return <Stack.Screen options={side === 'left' ? { headerLeft: render } : { headerRight: render }} />;
}

export function BottomBar({ items }: { items: BarItem[] }) {
  const insets = useSafeAreaInsets();
  // On Android the search field lives in the top bar, so its slot here is dropped.
  const visible = Platform.OS === 'android' ? items.filter((item) => item !== 'search') : items;
  const compacted = visible.filter((item, index) => !(item === 'space' && visible[index - 1] === 'space'));
  // Six buttons or more only fit a phone's width with narrower buttons and gaps.
  const tight = compacted.filter((item) => item !== 'space' && item !== 'search').length >= 6;
  return (
    <View style={[styles.bottom, tight && { gap: 6 }, { bottom: insets.bottom + 14 }]} pointerEvents="box-none">
      {compacted.map((item, index) => {
        if (item === 'space') {
          return <View key={index} style={{ flex: 1 }} pointerEvents="none" />;
        }
        if (item === 'search') {
          return (
            <View key={index} style={styles.search}>
              <Icon name="magnifyingglass" size={17} color={colors.textDim} />
              <Text style={{ color: colors.textDim, fontSize: 16 }}>Search</Text>
            </View>
          );
        }
        return <Button key={index} item={item} tight={tight} />;
      })}
    </View>
  );
}

// Height the bottom bar covers, for screens to pad their scrolling content.
export const bottomBarInset = 84;

const glass = {
  backgroundColor: 'rgba(38, 54, 96, 0.86)',
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: colors.hairlineStrong,
} as const;

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottom: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  button: {
    minWidth: 50,
    height: 50,
    paddingHorizontal: 13,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    ...glass,
  },
  tight: {
    minWidth: 46,
    paddingHorizontal: 11,
  },
  prominent: {
    backgroundColor: colors.accent,
    borderColor: 'transparent',
  },
  label: {
    color: colors.text,
    fontSize: 16,
  },
  search: {
    flex: 4,
    height: 50,
    borderRadius: 25,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    ...glass,
  },
});
