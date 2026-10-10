// Browser stand-in for the native bars, used only by the design preview.
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius } from '../theme';
import type { BarAction, BarItem } from './bar-types';
import { Icon } from './Icon';

function Menu({ entries, onClose, up }: { entries: BarAction[]; onClose: () => void; up: boolean }) {
  return (
    <View style={[styles.menu, up ? { bottom: 52 } : { top: 44 }]}>
      {entries.map((entry, index) => (
        <Pressable
          key={index}
          style={styles.menuRow}
          onPress={() => {
            onClose();
            entry.onPress?.();
          }}>
          <Text style={[styles.menuText, entry.destructive && { color: colors.danger }]}>
            {entry.on ? '✓ ' : ''}
            {entry.label}
          </Text>
          {entry.icon ? <Icon name={entry.icon} size={18} color={entry.destructive ? colors.danger : colors.text} /> : null}
        </Pressable>
      ))}
    </View>
  );
}

function Button({ item, up }: { item: BarAction; up: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable
        accessibilityLabel={item.label}
        disabled={item.disabled}
        style={[styles.button, item.prominent && styles.prominent, item.disabled && { opacity: 0.35 }]}
        onPress={() => (item.menu ? setOpen(!open) : item.onPress?.())}>
        {item.icon ? (
          <Icon name={item.icon} size={21} color={item.destructive ? colors.danger : colors.text} />
        ) : (
          <Text style={styles.menuText}>{item.label}</Text>
        )}
      </Pressable>
      {open && item.menu ? <Menu entries={item.menu} up={up} onClose={() => setOpen(false)} /> : null}
    </View>
  );
}

export function HeaderBar({ side = 'right', items }: { side?: 'left' | 'right'; items: BarAction[] }) {
  const render = () => (
    <View style={styles.header}>
      {items.map((item, index) => (
        <Button key={index} item={item} up={false} />
      ))}
    </View>
  );
  return <Stack.Screen options={side === 'left' ? { headerLeft: render } : { headerRight: render }} />;
}

export function BottomBar({ items }: { items: BarItem[] }) {
  return (
    <View style={styles.bottom} pointerEvents="box-none">
      {items.map((item, index) => {
        if (item === 'space') {
          return <View key={index} style={{ flex: 1 }} />;
        }
        if (item === 'search') {
          return (
            <View key={index} style={styles.search}>
              <Icon name="magnifyingglass" size={17} color={colors.textDim} />
              <Text style={{ color: colors.textDim, fontSize: 16 }}>Search</Text>
            </View>
          );
        }
        return <Button key={index} item={item} up />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 8,
  },
  bottom: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  button: {
    minWidth: 46,
    height: 46,
    paddingHorizontal: 12,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(60, 80, 130, 0.42)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairlineStrong,
  },
  prominent: {
    backgroundColor: colors.accent,
    borderColor: 'transparent',
  },
  search: {
    flex: 4,
    height: 46,
    borderRadius: 23,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(60, 80, 130, 0.42)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairlineStrong,
  },
  menu: {
    position: 'absolute',
    right: 0,
    minWidth: 220,
    borderRadius: radius.md,
    backgroundColor: '#161C2C',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairlineStrong,
    zIndex: 10,
  },
  menuRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  menuText: {
    color: colors.text,
    fontSize: 16,
  },
});
