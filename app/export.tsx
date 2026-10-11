import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { exportBackup, MIN_PASSWORD_LENGTH } from '../src/actions';
import { BottomBar, bottomBarInset } from '../src/components/Bars';
import { Icon } from '../src/components/Icon';
import { EmptyState, Glow, pageCount } from '../src/components/ui';
import { promptSecret, showError, success } from '../src/native-ui';
import { useStore } from '../src/store';
import { colors, radius, space, withAlpha } from '../src/theme';
import type { Doc } from '../src/types';

function Check({ state }: { state: 'on' | 'off' | 'some' }) {
  return (
    <View style={[styles.check, state !== 'off' && styles.checkOn]}>
      {state === 'on' ? <Icon name="checkmark" size={12} color={colors.text} weight="bold" /> : null}
      {state === 'some' ? <View style={styles.checkDash} /> : null}
    </View>
  );
}

// Lets the current dialog finish closing before the next one appears.
function later(action: () => void) {
  setTimeout(action, 400);
}

// Choose which folders and documents go into a backup file. The file can be restored
// on an iPhone or an Android phone alike.
export default function ExportScreen() {
  const router = useRouter();
  const folders = useStore((state) => state.folders);
  const docs = useStore((state) => state.docs);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(docs.map((doc) => doc.id)));
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => {
    const list: { key: string; name: string; color: string; docs: Doc[] }[] = folders.map((folder) => ({
      key: folder.id,
      name: folder.name,
      color: folder.color,
      docs: docs.filter((doc) => doc.folderId === folder.id),
    }));
    const loose = docs.filter((doc) => !folders.some((folder) => folder.id === doc.folderId));
    list.push({ key: 'none', name: 'No Folder', color: colors.textDim, docs: loose });
    return list.filter((group) => group.docs.length > 0);
  }, [folders, docs]);

  const chosen = docs.filter((doc) => selected.has(doc.id));
  const allOn = chosen.length === docs.length;

  const setMany = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    setSelected(next);
  };

  const run = async (password: string | null) => {
    setBusy(true);
    try {
      await exportBackup(password, allOn ? undefined : chosen.map((doc) => doc.id));
      success();
      router.back();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  // The password is asked twice: a typo would make the backup impossible to open.
  const start = () => {
    const required = chosen.some((doc) => doc.protected);
    const rule = `At least ${MIN_PASSWORD_LENGTH} characters.`;
    promptSecret(
      'Backup Password',
      required ? `${rule} It cannot be recovered.` : `${rule} Leave empty for a backup without encryption.`,
      (first) => {
        if (!first && !required) {
          later(() => run(null));
          return;
        }
        if (first.length < MIN_PASSWORD_LENGTH) {
          later(() => Alert.alert('Password too short', rule));
          return;
        }
        later(() =>
          promptSecret('Repeat Password', undefined, (second) => {
            if (second === first) {
              later(() => run(first));
            } else {
              later(() => Alert.alert('Passwords do not match'));
            }
          }),
        );
      },
    );
  };

  return (
    <>
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={styles.fill} contentContainerStyle={styles.content}>
        {docs.length === 0 ? (
          <EmptyState icon="doc.viewfinder" label="No documents" />
        ) : (
          <>
            <Pressable style={styles.all} onPress={() => setMany(docs.map((doc) => doc.id), !allOn)}>
              <Check state={allOn ? 'on' : chosen.length > 0 ? 'some' : 'off'} />
              <Text style={styles.allText}>Everything</Text>
              <Text style={styles.count}>
                {chosen.length} of {docs.length}
              </Text>
            </Pressable>

            {groups.map((group) => {
              const ids = group.docs.map((doc) => doc.id);
              const on = ids.filter((id) => selected.has(id)).length;
              return (
                <View key={group.key} style={styles.group}>
                  <Pressable style={styles.row} onPress={() => setMany(ids, on !== ids.length)}>
                    <Check state={on === ids.length ? 'on' : on > 0 ? 'some' : 'off'} />
                    <Icon name="folder.fill" size={17} color={group.color} />
                    <Text numberOfLines={1} style={styles.folderName}>
                      {group.name}
                    </Text>
                    <Text style={styles.count}>{ids.length}</Text>
                  </Pressable>
                  {group.docs.map((doc) => (
                    <Pressable
                      key={doc.id}
                      style={[styles.row, styles.docRow]}
                      onPress={() => setMany([doc.id], !selected.has(doc.id))}>
                      <Check state={selected.has(doc.id) ? 'on' : 'off'} />
                      <View style={styles.docBody}>
                        <Text numberOfLines={1} style={styles.docName}>
                          {doc.name}
                        </Text>
                        <Text style={styles.docMeta}>{pageCount(doc.pages.length)}</Text>
                      </View>
                      {doc.protected ? <Icon name="lock.fill" size={13} color={colors.accentSoft} /> : null}
                    </Pressable>
                  ))}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
      <Glow height={230} />
      {busy ? (
        <View pointerEvents="none" style={styles.busy}>
          <ActivityIndicator color={colors.text} />
        </View>
      ) : null}
      <BottomBar
        items={[
          'space',
          {
            icon: 'square.and.arrow.up',
            label: 'Export',
            prominent: true,
            disabled: busy || chosen.length === 0,
            onPress: start,
          },
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
  all: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    height: 54,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.glassStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairlineStrong,
  },
  allText: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  count: {
    color: colors.textDim,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  group: {
    marginTop: space.md,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  docRow: {
    paddingLeft: 30,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  folderName: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  docBody: {
    flex: 1,
    paddingVertical: 8,
  },
  docName: {
    color: colors.text,
    fontSize: 15,
  },
  docMeta: {
    color: colors.textFaint,
    fontSize: 12.5,
    marginTop: 2,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.hairlineStrong,
  },
  checkOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  checkDash: {
    width: 10,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.text,
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
