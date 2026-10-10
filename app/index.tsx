import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { importFromFiles, importFromPhotos, scanDocument, type Target } from '../src/actions';
import { BottomBar, HeaderBar } from '../src/components/Bars';
import { DocRow, FolderTile } from '../src/components/cards';
import { Card, Chip, EmptyState, Glow, SectionLabel, tagIcons, tagLabels } from '../src/components/ui';
import { openDocMenu } from '../src/doc-menu';
import { chooseOption, confirmDelete, promptText, showError, success, tap } from '../src/native-ui';
import { daysUntil, searchDocs, useStore } from '../src/store';
import { colors, folderColors, space } from '../src/theme';
import type { Doc, Folder, Tag } from '../src/types';

const tags: Tag[] = ['personal', 'professional'];

function snippet(doc: Doc, text: Record<string, string>, query: string) {
  const needle = query.trim().toLowerCase();
  for (const page of doc.pages) {
    const value = text[page.id] ?? '';
    const at = value.toLowerCase().indexOf(needle);
    if (at >= 0) {
      const start = Math.max(0, at - 18);
      return (start > 0 ? '…' : '') + value.slice(start, at + needle.length + 36).replace(/\s+/g, ' ');
    }
  }
  return undefined;
}

export default function Home() {
  const router = useRouter();
  const folders = useStore((state) => state.folders);
  const docs = useStore((state) => state.docs);
  const text = useStore((state) => state.text);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<Tag | null>(null);

  const scoped = useMemo(() => (tag ? docs.filter((doc) => doc.tag === tag) : docs), [docs, tag]);
  const results = useMemo(
    () => (query.trim() ? searchDocs(scoped, text, query) : null),
    [scoped, text, query],
  );
  const expiring = useMemo(
    () =>
      scoped
        .filter((doc) => doc.expiresAt !== null && daysUntil(doc.expiresAt) <= 60)
        .sort((a, b) => (a.expiresAt ?? 0) - (b.expiresAt ?? 0)),
    [scoped],
  );
  const recent = useMemo(() => [...scoped].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6), [scoped]);

  const target: Target = { folderId: null, tag };
  const openDoc = (id: string) => router.push({ pathname: '/doc/[id]', params: { id } });
  const openFolder = (id: string) => router.push({ pathname: '/folder/[id]', params: { id } });

  const scan = async () => {
    tap();
    try {
      const id = await scanDocument(target);
      if (id) {
        success();
        openDoc(id);
      }
    } catch (error) {
      showError(error);
    }
  };

  const importFiles = async () => {
    try {
      const created = await importFromFiles(target);
      if (created.length === 1) {
        openDoc(created[0]);
      }
    } catch (error) {
      showError(error);
    }
  };

  const importPhotos = async () => {
    try {
      const id = await importFromPhotos(target);
      if (id) {
        openDoc(id);
      }
    } catch (error) {
      showError(error);
    }
  };

  const newFolder = () => {
    promptText('New Folder', '', (name) => {
      const color = folderColors[useStore.getState().folders.length % folderColors.length];
      useStore.getState().addFolder(name, color);
    });
  };

  const folderMenu = (folder: Folder) => {
    chooseOption(
      [
        {
          label: 'Rename',
          onPress: () =>
            setTimeout(
              () => promptText('Rename', folder.name, (name) => useStore.getState().updateFolder(folder.id, { name })),
              350,
            ),
        },
        { label: 'Color', onPress: () => router.push({ pathname: '/folder-color', params: { id: folder.id } }) },
        {
          label: 'Delete',
          destructive: true,
          onPress: () =>
            setTimeout(
              () =>
                confirmDelete(`Delete “${folder.name}”?`, 'Its documents are kept.', () =>
                  useStore.getState().removeFolder(folder.id),
                ),
              350,
            ),
        },
      ],
      folder.name,
    );
  };

  const tiles: (Folder | 'all')[] = ['all', ...folders];
  const rows: (Folder | 'all')[][] = [];
  for (let index = 0; index < tiles.length; index += 2) {
    rows.push(tiles.slice(index, index + 2));
  }

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.content}
        style={styles.scroll}>
        {results ? (
          results.length > 0 ? (
            <Card>
              {results.map((doc) => (
                <DocRow
                  key={doc.id}
                  doc={doc}
                  detail={snippet(doc, text, query)}
                  onPress={() => openDoc(doc.id)}
                  onLongPress={() => openDocMenu(doc)}
                />
              ))}
            </Card>
          ) : (
            <EmptyState icon="magnifyingglass" label="No results" />
          )
        ) : (
          <>
            <View style={styles.chips}>
              <Chip label="All" active={tag === null} onPress={() => setTag(null)} />
              {tags.map((value) => (
                <Chip
                  key={value}
                  label={tagLabels[value]}
                  icon={tagIcons[value]}
                  active={tag === value}
                  onPress={() => setTag(tag === value ? null : value)}
                />
              ))}
            </View>

            {expiring.length > 0 ? (
              <View style={styles.section}>
                <SectionLabel>Expiring</SectionLabel>
                <Card>
                  {expiring.slice(0, 3).map((doc) => (
                    <DocRow key={doc.id} doc={doc} onPress={() => openDoc(doc.id)} onLongPress={() => openDocMenu(doc)} />
                  ))}
                </Card>
              </View>
            ) : null}

            <View style={styles.section}>
              <SectionLabel>Folders</SectionLabel>
              <View style={styles.grid}>
                {rows.map((row, index) => (
                  <View key={index} style={styles.gridRow}>
                    {row.map((item) =>
                      item === 'all' ? (
                        <FolderTile
                          key="all"
                          name="All"
                          icon="tray.full.fill"
                          color={colors.accentSoft}
                          count={scoped.length}
                          onPress={() => openFolder('all')}
                        />
                      ) : (
                        <FolderTile
                          key={item.id}
                          name={item.name}
                          color={item.color}
                          count={scoped.filter((doc) => doc.folderId === item.id).length}
                          onPress={() => openFolder(item.id)}
                          onLongPress={() => folderMenu(item)}
                        />
                      ),
                    )}
                    {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
                  </View>
                ))}
              </View>
            </View>

            {recent.length > 0 ? (
              <View style={styles.section}>
                <SectionLabel>Recent</SectionLabel>
                <Card>
                  {recent.map((doc) => (
                    <DocRow key={doc.id} doc={doc} onPress={() => openDoc(doc.id)} onLongPress={() => openDocMenu(doc)} />
                  ))}
                </Card>
              </View>
            ) : (
              <EmptyState icon="doc.viewfinder" label="Scan your first document" />
            )}
            {docs.length === 0 ? <Text style={styles.hint}>Everything stays on this iPhone.</Text> : null}
          </>
        )}
      </ScrollView>
      <Glow />
      <Stack.SearchBar
        placeholder="Search"
        hideWhenScrolling={false}
        onChangeText={(event) => setQuery(event.nativeEvent.text)}
        onCancelButtonPress={() => setQuery('')}
      />
      <HeaderBar items={[{ icon: 'gearshape', label: 'Settings', onPress: () => router.push('/settings') }]} />
      <BottomBar
        items={[
          {
            icon: 'plus',
            label: 'Add',
            menu: [
              { icon: 'folder.badge.plus', label: 'New Folder', onPress: newFolder },
              { icon: 'arrow.down.doc', label: 'Import from Files', onPress: importFiles },
              { icon: 'photo.on.rectangle', label: 'Import from Photos', onPress: importPhotos },
            ],
          },
          'space',
          'search',
          'space',
          { icon: 'doc.viewfinder', label: 'Scan', prominent: true, onPress: scan },
        ]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.black,
  },
  content: {
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: 40,
  },
  chips: {
    flexDirection: 'row',
    gap: 8,
  },
  section: {
    marginTop: space.xl,
  },
  grid: {
    gap: 12,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 12,
  },
  hint: {
    color: colors.textFaint,
    fontSize: 13,
    textAlign: 'center',
    marginTop: -40,
  },
});
