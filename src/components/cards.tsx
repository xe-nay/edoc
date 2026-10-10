import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { pageUri } from '../storage';
import { colors, radius, withAlpha } from '../theme';
import type { Doc } from '../types';
import { Icon, type IconName } from './Icon';
import { ExpiryPill, formatDate, pageCount, tagIcons } from './ui';

export function Thumb({ doc, style }: { doc: Doc; style?: StyleProp<ViewStyle> }) {
  const first = doc.pages[0];
  return (
    <View style={[styles.thumb, style]}>
      {first ? (
        <Image
          source={{ uri: pageUri(doc.id, first.file) }}
          recyclingKey={first.file}
          contentFit="cover"
          contentPosition="top"
          transition={120}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
    </View>
  );
}

type TileProps = {
  name: string;
  count: number;
  color: string;
  icon?: IconName;
  onPress: () => void;
  onLongPress?: () => void;
};

export function FolderTile({ name, count, color, icon = 'folder.fill', onPress, onLongPress }: TileProps) {
  // The outer view takes the grid column; padding on a flex child would skew column widths.
  return (
    <View style={styles.tileCell}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
        <LinearGradient
          colors={[withAlpha(color, 0.26), withAlpha(color, 0.04), 'transparent']}
          locations={[0, 0.55, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.tileTop}>
          <View style={[styles.tileIcon, { backgroundColor: withAlpha(color, 0.2), shadowColor: color }]}>
            <Icon name={icon} size={20} color={color} weight="semibold" />
          </View>
          <Text style={styles.tileCount}>{count}</Text>
        </View>
        <Text numberOfLines={1} style={styles.tileName}>
          {name}
        </Text>
      </Pressable>
    </View>
  );
}

type DocProps = {
  doc: Doc;
  onPress: () => void;
  onLongPress?: () => void;
};

export function DocCard({ doc, onPress, onLongPress }: DocProps) {
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [styles.docCard, pressed && styles.pressed]}>
      <View>
        <Thumb doc={doc} style={styles.docCardThumb} />
        <View style={styles.badges}>
          {doc.tag ? (
            <View style={styles.badge}>
              <Icon name={tagIcons[doc.tag]} size={11} color={colors.text} />
            </View>
          ) : null}
          {doc.favorite ? (
            <View style={styles.badge}>
              <Icon name="star.fill" size={11} color={colors.warning} />
            </View>
          ) : null}
        </View>
        {doc.expiresAt !== null ? (
          <View style={styles.cardExpiry}>
            <ExpiryPill expiresAt={doc.expiresAt} />
          </View>
        ) : null}
      </View>
      <Text numberOfLines={1} style={styles.docName}>
        {doc.name}
      </Text>
      <Text style={styles.docMeta}>
        {pageCount(doc.pages.length)} · {formatDate(doc.updatedAt)}
      </Text>
    </Pressable>
  );
}

export function DocRow({ doc, onPress, onLongPress, detail }: DocProps & { detail?: string }) {
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Thumb doc={doc} style={styles.rowThumb} />
      <View style={styles.rowBody}>
        <View style={styles.rowTitle}>
          {doc.favorite ? <Icon name="star.fill" size={12} color={colors.warning} /> : null}
          <Text numberOfLines={1} style={[styles.docName, { marginTop: 0, flexShrink: 1 }]}>
            {doc.name}
          </Text>
        </View>
        <Text numberOfLines={1} style={styles.docMeta}>
          {detail ?? `${pageCount(doc.pages.length)} · ${formatDate(doc.updatedAt)}`}
        </Text>
      </View>
      {doc.expiresAt !== null ? <ExpiryPill expiresAt={doc.expiresAt} /> : null}
      {doc.tag ? <Icon name={tagIcons[doc.tag]} size={14} color={colors.textFaint} /> : null}
      <Icon name="chevron.right" size={13} color={colors.textFaint} weight="semibold" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.6,
  },
  thumb: {
    backgroundColor: colors.paper,
    borderRadius: 8,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  tileCell: {
    flex: 1,
  },
  tile: {
    height: 116,
    padding: 14,
    justifyContent: 'space-between',
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    overflow: 'hidden',
  },
  tileTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.6,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  tileCount: {
    color: colors.textDim,
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  tileName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  docCard: {
    flex: 1,
  },
  docCardThumb: {
    aspectRatio: 0.76,
    borderRadius: radius.md,
  },
  badges: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    gap: 5,
  },
  badge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(6, 12, 30, 0.72)',
  },
  cardExpiry: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    borderRadius: 11,
    backgroundColor: 'rgba(6, 12, 30, 0.82)',
  },
  docName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
    marginTop: 9,
  },
  docMeta: {
    color: colors.textFaint,
    fontSize: 12.5,
    marginTop: 3,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  rowThumb: {
    width: 40,
    height: 52,
    borderRadius: 7,
  },
  rowBody: {
    flex: 1,
  },
  rowTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
});
