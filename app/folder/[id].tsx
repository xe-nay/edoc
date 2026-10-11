import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { importFromFiles, importFromPhotos, scanDocument, type Target } from '../../src/actions';
import { nameThenOpen } from '../../src/add-flow';
import { BottomBar, HeaderBar } from '../../src/components/Bars';
import type { BarAction } from '../../src/components/bar-types';
import { DocCard } from '../../src/components/cards';
import { EmptyState, Glow, tagLabels } from '../../src/components/ui';
import { openDocMenu } from '../../src/doc-menu';
import { confirmDelete, promptText, showError, success, tap } from '../../src/native-ui';
import { useStore } from '../../src/store';
import { colors, space } from '../../src/theme';
import type { Doc, Tag } from '../../src/types';

type Sort = 'recent' | 'name' | 'expiry';

function sortDocs(docs: Doc[], sort: Sort) {
  const sorted = [...docs];
  if (sort === 'name') {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sort === 'expiry') {
    sorted.sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity));
  } else {
    sorted.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  return sorted;
}

export default function FolderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  // Besides real folders, this screen shows everything ("all") or one tag ("tag-personal", "tag-professional").
  const isAll = id === 'all';
  const tag: Tag | null = id === 'tag-personal' ? 'personal' : id === 'tag-professional' ? 'professional' : null;
  const folder = useStore((state) => state.folders.find((item) => item.id === id));
  const docs = useStore((state) => state.docs);
  const [sort, setSort] = useState<Sort>('recent');

  const visible = useMemo(() => {
    const matching = isAll
      ? docs
      : tag
        ? docs.filter((doc) => doc.tag === tag)
        : docs.filter((doc) => doc.folderId === id);
    return sortDocs(matching, sort);
  }, [docs, id, isAll, tag, sort]);
  // An odd count gets an empty cell so the last card keeps its column width.
  const cells: (Doc | null)[] = visible.length % 2 === 1 ? [...visible, null] : visible;

  const target: Target = { folderId: folder ? folder.id : null, tag };
  const title = isAll ? 'All' : tag ? tagLabels[tag] : (folder?.name ?? '');
  const openDoc = (docId: string) => router.push({ pathname: '/doc/[id]', params: { id: docId } });

  const run = async (task: () => Promise<string | null>) => {
    try {
      const docId = await task();
      if (docId) {
        success();
        nameThenOpen(docId, openDoc);
      }
    } catch (error) {
      showError(error);
    }
  };

  const sortEntries: BarAction[] = [
    { label: 'Recent', icon: 'clock', on: sort === 'recent', onPress: () => setSort('recent') },
    { label: 'Name', icon: 'doc.text.fill', on: sort === 'name', onPress: () => setSort('name') },
    { label: 'Expiry', icon: 'calendar', on: sort === 'expiry', onPress: () => setSort('expiry') },
  ];
  const folderEntries: BarAction[] =
    folder
      ? [
          {
            label: 'Rename',
            icon: 'pencil',
            onPress: () =>
              promptText('Rename', folder.name, (name) => useStore.getState().updateFolder(folder.id, { name })),
          },
          {
            label: 'Color',
            icon: 'camera.filters',
            onPress: () => router.push({ pathname: '/folder-color', params: { id: folder.id } }),
          },
          {
            label: 'Delete Folder',
            icon: 'trash',
            destructive: true,
            onPress: () =>
              confirmDelete(`Delete “${folder.name}”?`, 'Its documents are kept.', () => {
                useStore.getState().removeFolder(folder.id);
                router.back();
              }),
          },
        ]
      : [];

  return (
    <>
      <FlatList
        data={cells}
        keyExtractor={(item, index) => item?.id ?? `empty-${index}`}
        numColumns={2}
        contentInsetAdjustmentBehavior="automatic"
        columnWrapperStyle={styles.columns}
        contentContainerStyle={styles.content}
        style={styles.list}
        ListEmptyComponent={<EmptyState icon="doc.viewfinder" label="No documents" />}
        renderItem={({ item }) =>
          item ? (
            <DocCard doc={item} onPress={() => openDoc(item.id)} onLongPress={() => openDocMenu(item)} />
          ) : (
            <View style={{ flex: 1 }} />
          )
        }
      />
      <Glow height={230} />
      <Stack.Screen options={{ title }} />
      <HeaderBar items={[{ icon: 'ellipsis', label: 'More', menu: [...sortEntries, ...folderEntries] }]} />
      <BottomBar
        items={[
          {
            icon: 'plus',
            label: 'Import',
            menu: [
              {
                icon: 'arrow.down.doc',
                label: 'Import from Files',
                onPress: () =>
                  run(async () => {
                    const created = await importFromFiles(target);
                    return created.length === 1 ? created[0] : null;
                  }),
              },
              {
                icon: 'photo.on.rectangle',
                label: 'Import from Photos',
                onPress: () => run(() => importFromPhotos(target)),
              },
            ],
          },
          'space',
          {
            icon: 'doc.viewfinder',
            label: 'Scan',
            prominent: true,
            onPress: () => {
              tap();
              run(() => scanDocument(target));
            },
          },
        ]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: colors.black,
  },
  content: {
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: 40,
  },
  columns: {
    gap: 14,
    marginBottom: 22,
  },
});
