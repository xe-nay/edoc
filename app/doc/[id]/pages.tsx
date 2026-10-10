import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { deletePage, movePage, rotatePage, scanMorePages, setPageFilter } from '../../../src/actions';
import { BottomBar } from '../../../src/components/Bars';
import type { BarAction } from '../../../src/components/bar-types';
import { confirmDelete, showError, tap } from '../../../src/native-ui';
import { pageUri } from '../../../src/storage';
import { useStore } from '../../../src/store';
import { colors, space, withAlpha } from '../../../src/theme';
import type { Page, PageFilter } from '../../../src/types';

const filters: { value: PageFilter; label: string }[] = [
  { value: 'none', label: 'Original' },
  { value: 'enhance', label: 'Enhance' },
  { value: 'gray', label: 'Grayscale' },
  { value: 'bw', label: 'Black & White' },
];

const COLUMNS = 3;

export default function PagesScreen() {
  const params = useLocalSearchParams<{ id: string; page?: string }>();
  const router = useRouter();
  const doc = useStore((state) => state.docs.find((item) => item.id === params.id));
  const [selectedId, setSelectedId] = useState<string | null>(
    () => doc?.pages[Number(params.page ?? 0)]?.id ?? doc?.pages[0]?.id ?? null,
  );
  const [busy, setBusy] = useState(false);

  if (!doc) {
    return <View style={styles.fill} />;
  }

  const index = doc.pages.findIndex((page) => page.id === selectedId);
  const selected: Page | undefined = doc.pages[index];
  const none = !selected || busy;

  const work = async (task: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const move = (step: number) => {
    tap();
    movePage(doc.id, index, index + step);
  };

  const remove = () => {
    if (!selected) {
      return;
    }
    const last = doc.pages.length === 1;
    confirmDelete(last ? 'Delete this document?' : 'Delete this page?', undefined, () => {
      const next = doc.pages[index + 1]?.id ?? doc.pages[index - 1]?.id ?? null;
      work(async () => {
        const stillThere = await deletePage(doc.id, selected.id);
        if (stillThere) {
          setSelectedId(next);
        } else {
          router.dismissTo('/');
        }
      });
    });
  };

  const filterMenu: BarAction[] = filters.map((filter) => ({
    label: filter.label,
    on: (selected?.filter ?? 'none') === filter.value,
    onPress: () => {
      if (selected) {
        work(() => setPageFilter(doc.id, selected.id, filter.value));
      }
    },
  }));

  // Pad the last row so every cell keeps the same width.
  const cells: (Page | null)[] = [...doc.pages];
  while (cells.length % COLUMNS !== 0) {
    cells.push(null);
  }

  return (
    <>
      <FlatList
        data={cells}
        keyExtractor={(item, cellIndex) => (item ? item.id + item.file : `empty-${cellIndex}`)}
        numColumns={COLUMNS}
        contentInsetAdjustmentBehavior="automatic"
        columnWrapperStyle={styles.columns}
        contentContainerStyle={styles.content}
        style={styles.fill}
        renderItem={({ item, index: cellIndex }) =>
          item ? (
            <Pressable style={styles.cell} onPress={() => setSelectedId(item.id)}>
              <View style={[styles.frame, item.id === selectedId && styles.frameSelected]}>
                <Image
                  source={{ uri: pageUri(doc.id, item.file) }}
                  contentFit="cover"
                  contentPosition="top"
                  style={styles.image}
                />
              </View>
              <Text style={[styles.number, item.id === selectedId && { color: colors.text }]}>{cellIndex + 1}</Text>
            </Pressable>
          ) : (
            <View style={styles.cell} />
          )
        }
      />
      {busy ? (
        <View pointerEvents="none" style={styles.busy}>
          <ActivityIndicator color={colors.text} />
        </View>
      ) : null}
      <BottomBar
        items={[
          { icon: 'arrow.left', label: 'Move Back', disabled: none || index === 0, onPress: () => move(-1) },
          {
            icon: 'arrow.right',
            label: 'Move Forward',
            disabled: none || index === doc.pages.length - 1,
            onPress: () => move(1),
          },
          'space',
          {
            icon: 'rotate.right',
            label: 'Rotate',
            disabled: none,
            onPress: () => selected && work(() => rotatePage(doc.id, selected.id)),
          },
          { icon: 'camera.filters', label: 'Filter', disabled: none, menu: filterMenu },
          { icon: 'plus.viewfinder', label: 'Add Pages', onPress: () => work(() => scanMorePages(doc.id)) },
          'space',
          { icon: 'trash', label: 'Delete', destructive: true, disabled: none, onPress: remove },
        ]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: colors.black,
  },
  content: {
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: 40,
  },
  columns: {
    gap: 12,
    marginBottom: 14,
  },
  cell: {
    flex: 1,
    alignItems: 'center',
  },
  frame: {
    width: '100%',
    aspectRatio: 0.74,
    borderRadius: 12,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.paper,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  frameSelected: {
    borderColor: colors.accent,
  },
  image: {
    flex: 1,
  },
  number: {
    color: colors.textFaint,
    fontSize: 12.5,
    fontWeight: '600',
    marginTop: 6,
    fontVariant: ['tabular-nums'],
  },
  busy: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(colors.black, 0.45),
  },
});
