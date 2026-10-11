import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { importFromFiles, importFromPhotos, scanDocument, type Target } from '../src/actions';
import { nameThenOpen } from '../src/add-flow';
import { BottomBar, HeaderBar, bottomBarInset } from '../src/components/Bars';
import { DocCard, DocRow, FolderTile } from '../src/components/cards';
import { Icon, type IconName } from '../src/components/Icon';
import { Card, Chip, EmptyState, Glow, SectionLabel, tagIcons, tagLabels } from '../src/components/ui';
import { openDocMenu } from '../src/doc-menu';
import { chooseOption, confirmDelete, deviceName, promptText, showError, success, tap } from '../src/native-ui';
import { URGENT_DAYS } from '../src/reminders';
import { daysUntil, searchDocs, useStore } from '../src/store';
import { colors, folderColors, space } from '../src/theme';
import type { Doc, Folder, Tag } from '../src/types';

const tags: Tag[] = ['personal', 'professional'];

const tagColors: Record<Tag, string> = { personal: colors.cyan, professional: '#A66BFF' };

// What the strip at the top has selected: everything, one tag, or one folder.
type Selection = { kind: 'all' } | { kind: 'tag'; tag: Tag } | { kind: 'folder'; id: string };

type Tile = {
  key: string;
  name: string;
  count: number;
  color: string;
  icon?: IconName;
  // Route id of the folder screen this tile opens.
  open: string;
  folder?: Folder;
};

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

function pairs<T>(items: T[]) {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += 2) {
    rows.push(items.slice(index, index + 2));
  }
  return rows;
}

export default function Home() {
  const router = useRouter();
  const folders = useStore((state) => state.folders);
  const docs = useStore((state) => state.docs);
  const text = useStore((state) => state.text);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Selection>({ kind: 'all' });

  // A folder that was deleted while selected falls back to everything.
  const selection: Selection =
    picked.kind === 'folder' && !folders.some((folder) => folder.id === picked.id) ? { kind: 'all' } : picked;

  const selectedTag = selection.kind === 'tag' ? selection.tag : null;
  const selectedFolder = selection.kind === 'folder' ? selection.id : null;

  const selected = useMemo(() => {
    const matching = selectedTag
      ? docs.filter((doc) => doc.tag === selectedTag)
      : selectedFolder
        ? docs.filter((doc) => doc.folderId === selectedFolder)
        : docs;
    return [...matching].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [docs, selectedTag, selectedFolder]);

  const results = useMemo(() => (query.trim() ? searchDocs(docs, text, query) : null), [docs, text, query]);
  const expiring = useMemo(
    () =>
      docs
        .filter((doc) => doc.expiresAt !== null && daysUntil(doc.expiresAt) <= 60)
        .sort((a, b) => (a.expiresAt ?? 0) - (b.expiresAt ?? 0)),
    [docs],
  );
  // Documents about to expire are pinned to the very top; the rest stay in their own section.
  const urgent = expiring.filter((doc) => daysUntil(doc.expiresAt ?? 0) <= URGENT_DAYS);
  const upcoming = expiring.filter((doc) => daysUntil(doc.expiresAt ?? 0) > URGENT_DAYS);
  const recent = selected.slice(0, 6);

  // New documents land in whatever is selected at the top.
  const target: Target = { folderId: selectedFolder, tag: selectedTag };
  const openDoc = (id: string) => router.push({ pathname: '/doc/[id]', params: { id } });
  const openFolder = (id: string) => router.push({ pathname: '/folder/[id]', params: { id } });

  const add = async (task: () => Promise<string | null>) => {
    try {
      const id = await task();
      if (id) {
        success();
        nameThenOpen(id, openDoc);
      }
    } catch (error) {
      showError(error);
    }
  };

  const scan = () => {
    tap();
    add(() => scanDocument(target));
  };

  // Several files imported at once keep their own file names and are not opened.
  const importFiles = () =>
    add(async () => {
      const created = await importFromFiles(target);
      return created.length === 1 ? created[0] : null;
    });

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

  const isPicked = (other: Selection) =>
    selection.kind === other.kind &&
    (selection.kind !== 'tag' || (other.kind === 'tag' && selection.tag === other.tag)) &&
    (selection.kind !== 'folder' || (other.kind === 'folder' && selection.id === other.id));
  const toggle = (other: Selection) => setPicked(isPicked(other) ? { kind: 'all' } : other);

  // Personal and Professional sit in the grid as folders of their own, next to the ones created by hand.
  const tiles: Tile[] = [
    { key: 'all', name: 'All', count: docs.length, color: colors.accentSoft, icon: 'tray.full.fill', open: 'all' },
    ...tags.map((tag) => ({
      key: tag,
      name: tagLabels[tag],
      count: docs.filter((doc) => doc.tag === tag).length,
      color: tagColors[tag],
      icon: tagIcons[tag],
      open: `tag-${tag}`,
    })),
    ...folders.map((folder) => ({
      key: folder.id,
      name: folder.name,
      count: docs.filter((doc) => doc.folderId === folder.id).length,
      color: folder.color,
      open: folder.id,
      folder,
    })),
  ];

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
            {urgent.length > 0 ? (
              <View style={styles.alert}>
                <View style={styles.alertHead}>
                  <Icon name="exclamationmark.triangle.fill" size={13} color={colors.danger} weight="semibold" />
                  <Text style={styles.alertTitle}>Expiring soon</Text>
                </View>
                {urgent.map((doc) => (
                  <DocRow key={doc.id} doc={doc} onPress={() => openDoc(doc.id)} onLongPress={() => openDocMenu(doc)} />
                ))}
              </View>
            ) : null}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.strip}
              contentContainerStyle={styles.stripContent}>
              <Chip label="All" active={selection.kind === 'all'} onPress={() => setPicked({ kind: 'all' })} />
              {tags.map((tag) => (
                <Chip
                  key={tag}
                  label={tagLabels[tag]}
                  icon={tagIcons[tag]}
                  active={isPicked({ kind: 'tag', tag })}
                  onPress={() => toggle({ kind: 'tag', tag })}
                />
              ))}
              {folders.map((folder) => (
                <Chip
                  key={folder.id}
                  label={folder.name}
                  icon="folder.fill"
                  iconColor={folder.color}
                  active={isPicked({ kind: 'folder', id: folder.id })}
                  onPress={() => toggle({ kind: 'folder', id: folder.id })}
                  onLongPress={() => folderMenu(folder)}
                />
              ))}
            </ScrollView>

            {selection.kind === 'all' ? (
              <>
                {upcoming.length > 0 ? (
                  <View style={styles.section}>
                    <SectionLabel>Expiring</SectionLabel>
                    <Card>
                      {upcoming.slice(0, 3).map((doc) => (
                        <DocRow
                          key={doc.id}
                          doc={doc}
                          onPress={() => openDoc(doc.id)}
                          onLongPress={() => openDocMenu(doc)}
                        />
                      ))}
                    </Card>
                  </View>
                ) : null}

                <View style={styles.section}>
                  <SectionLabel>Folders</SectionLabel>
                  <View style={styles.grid}>
                    {pairs(tiles).map((row, index) => (
                      <View key={index} style={styles.gridRow}>
                        {row.map((tile) => (
                          <FolderTile
                            key={tile.key}
                            name={tile.name}
                            icon={tile.icon}
                            color={tile.color}
                            count={tile.count}
                            onPress={() => openFolder(tile.open)}
                            onLongPress={tile.folder ? () => folderMenu(tile.folder as Folder) : undefined}
                          />
                        ))}
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
                        <DocRow
                          key={doc.id}
                          doc={doc}
                          onPress={() => openDoc(doc.id)}
                          onLongPress={() => openDocMenu(doc)}
                        />
                      ))}
                    </Card>
                  </View>
                ) : (
                  <EmptyState icon="doc.viewfinder" label="Scan your first document" />
                )}
                {docs.length === 0 ? <Text style={styles.hint}>Everything stays on this {deviceName}.</Text> : null}
              </>
            ) : selected.length > 0 ? (
              <View style={[styles.section, styles.docs]}>
                {pairs(selected).map((row, index) => (
                  <View key={index} style={styles.docsRow}>
                    {row.map((doc) => (
                      <DocCard
                        key={doc.id}
                        doc={doc}
                        onPress={() => openDoc(doc.id)}
                        onLongPress={() => openDocMenu(doc)}
                      />
                    ))}
                    {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
                  </View>
                ))}
              </View>
            ) : (
              <EmptyState icon="doc.viewfinder" label="No documents" />
            )}
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
              {
                icon: 'photo.on.rectangle',
                label: 'Import from Photos',
                onPress: () => add(() => importFromPhotos(target)),
              },
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
    paddingBottom: 40 + bottomBarInset,
  },
  alert: {
    marginBottom: space.md,
    borderRadius: 24,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255, 90, 110, 0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 90, 110, 0.4)',
    overflow: 'hidden',
  },
  alertHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  alertTitle: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  // The strip runs edge to edge so chips slide under the screen edges.
  strip: {
    marginHorizontal: -space.md,
    flexGrow: 0,
  },
  stripContent: {
    paddingHorizontal: space.md,
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
  docs: {
    marginTop: space.lg,
    gap: 22,
  },
  docsRow: {
    flexDirection: 'row',
    gap: 14,
  },
  hint: {
    color: colors.textFaint,
    fontSize: 13,
    textAlign: 'center',
    marginTop: -40,
  },
});
