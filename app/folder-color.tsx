import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '../src/components/Icon';
import { tap } from '../src/native-ui';
import { useStore } from '../src/store';
import { colors, folderColors, space, withAlpha } from '../src/theme';

export default function FolderColorSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const folder = useStore((state) => state.folders.find((item) => item.id === id));

  if (!folder) {
    return <View style={styles.fill} />;
  }

  return (
    <View style={styles.fill}>
      <View style={styles.header}>
        <View style={[styles.preview, { backgroundColor: withAlpha(folder.color, 0.2) }]}>
          <Icon name="folder.fill" size={22} color={folder.color} weight="semibold" />
        </View>
        <Text numberOfLines={1} style={styles.name}>
          {folder.name}
        </Text>
      </View>
      <View style={styles.swatches}>
        {folderColors.map((color) => (
          <Pressable
            key={color}
            hitSlop={4}
            onPress={() => {
              tap();
              useStore.getState().updateFolder(folder.id, { color });
              router.back();
            }}
            style={[styles.swatch, { backgroundColor: color, shadowColor: color }]}>
            {color === folder.color ? <Icon name="checkmark" size={16} color="#04102E" weight="bold" /> : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: colors.navy,
    padding: space.lg,
    paddingTop: 34,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  preview: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    flexShrink: 1,
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  swatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginTop: space.xl,
  },
  swatch: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.55,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
});
