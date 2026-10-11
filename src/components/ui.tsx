import type { ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { daysUntil } from '../store';
import { colors, radius, space, withAlpha } from '../theme';
import type { Tag } from '../types';
import { Icon, type IconName } from './Icon';

// Blue glow rising from the bottom edge. Rendered after the scroll view so the
// native large title still tracks scrolling.
export function Glow({ height = 400 }: { height?: number }) {
  return (
    <View pointerEvents="none" style={[styles.glow, { height }]}>
      <Image source={require('../../assets/glow.png')} resizeMode="stretch" style={styles.glowImage} />
    </View>
  );
}

export function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Chip({
  label,
  icon,
  iconColor,
  active,
  onPress,
  onLongPress,
}: {
  label: string;
  icon?: IconName;
  // Fixed icon tint (a folder's colour); defaults to the text colour.
  iconColor?: string;
  active: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={[styles.chip, active && styles.chipActive]}>
      {icon ? <Icon name={icon} size={14} color={iconColor ?? (active ? colors.text : colors.textDim)} /> : null}
      <Text style={[styles.chipText, active && { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

export const tagIcons: Record<Tag, IconName> = {
  personal: 'person.fill',
  professional: 'briefcase.fill',
};

export const tagLabels: Record<Tag, string> = {
  personal: 'Personal',
  professional: 'Professional',
};

export function expiryColor(days: number) {
  if (days <= 7) {
    return colors.danger;
  }
  if (days <= 30) {
    return colors.warning;
  }
  return colors.cyan;
}

export function expiryText(days: number) {
  if (days < 0) {
    return 'Expired';
  }
  if (days === 0) {
    return 'Today';
  }
  return `${days} d`;
}

export function ExpiryPill({ expiresAt }: { expiresAt: number }) {
  const days = daysUntil(expiresAt);
  const color = expiryColor(days);
  return (
    <View style={[styles.pill, { backgroundColor: withAlpha(color, 0.16), borderColor: withAlpha(color, 0.4) }]}>
      <Icon name="clock" size={11} color={color} weight="semibold" />
      <Text style={[styles.pillText, { color }]}>{expiryText(days)}</Text>
    </View>
  );
}

export function EmptyState({ icon, label }: { icon: IconName; label: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={30} color={colors.accentSoft} weight="regular" />
      </View>
      <Text style={styles.emptyText}>{label}</Text>
    </View>
  );
}

export function formatDate(timestamp: number, withYear = false) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: withYear ? 'numeric' : undefined,
  });
}

export function pageCount(count: number) {
  return count === 1 ? '1 page' : `${count} pages`;
}

const styles = StyleSheet.create({
  glow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  glowImage: {
    width: '100%',
    height: '100%',
  },
  sectionLabel: {
    color: colors.textFaint,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: space.sm,
    marginLeft: 4,
  },
  card: {
    backgroundColor: colors.glass,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    overflow: 'hidden',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  chipActive: {
    backgroundColor: withAlpha(colors.accent, 0.3),
    borderColor: withAlpha(colors.accentSoft, 0.6),
  },
  chipText: {
    color: colors.textDim,
    fontSize: 14,
    fontWeight: '600',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  empty: {
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 72,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(colors.accent, 0.12),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(colors.accentSoft, 0.3),
  },
  emptyText: {
    color: colors.textDim,
    fontSize: 15,
  },
});
