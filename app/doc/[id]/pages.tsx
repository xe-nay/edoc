import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { deletePage, movePage, rescanPage, rotatePage, scanMorePages, setPageFilter } from '../../../src/actions';
import { useColumns } from '../../../src/columns';
import { BottomBar, HeaderBar, bottomBarInset } from '../../../src/components/Bars';
import type { BarAction } from '../../../src/components/bar-types';
import { PageGrid } from '../../../src/components/PageGrid';
import { confirmDelete, showError, success, tap } from '../../../src/native-ui';
import { useStore } from '../../../src/store';
import { colors, space, withAlpha } from '../../../src/theme';
import type { Page, PageFilter } from '../../../src/types';

const filters: { value: PageFilter; label: string }[] = [
  { value: 'none', label: 'Original' },
  { value: 'flex', label: 'Flex' },
  { value: 'enhance', label: 'Enhance' },
  { value: 'gray', label: 'Grayscale' },
  { value: 'bw', label: 'Black & White' },
];

// Three columns on a phone; a tablet fits more pages of about the same size.
const PHONE_COLUMNS = 3;
const CELL_WIDTH = 130;

export default function PagesScreen() {
  const params = useLocalSearchParams<{ id: string; page?: string }>();
  const router = useRouter();
  const doc = useStore((state) => state.docs.find((item) => item.id === params.id));
  const [selectedId, setSelectedId] = useState<string | null>(
    () => doc?.pages[Number(params.page ?? 0)]?.id ?? doc?.pages[0]?.id ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const columns = useColumns(PHONE_COLUMNS, CELL_WIDTH);

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

  // The new scan takes the selected page's place, keeping the order of the others.
  const rescan = () => {
    if (!selected) {
      return;
    }
    work(async () => {
      const replacement = await rescanPage(doc.id, selected.id);
      if (replacement) {
        setSelectedId(replacement);
        success();
      }
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

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        scrollEnabled={!dragging}
        contentContainerStyle={styles.content}
        style={styles.fill}>
        <PageGrid
          doc={doc}
          columns={columns}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onMove={(from, to) => movePage(doc.id, from, to)}
          onDragChange={setDragging}
        />
      </ScrollView>      {busy ? (
        <View pointerEvents="none" style={styles.busy}>
          <ActivityIndicator color={colors.text} />
        </View>
      ) : null}
      <HeaderBar
        items={[{ icon: 'plus.viewfinder', label: 'Add Pages', onPress: () => work(() => scanMorePages(doc.id)) }]}
      />
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
          { icon: 'arrow.triangle.2.circlepath.camera', label: 'Rescan Page', disabled: none, onPress: rescan },
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
    paddingBottom: 40 + bottomBarInset,
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
