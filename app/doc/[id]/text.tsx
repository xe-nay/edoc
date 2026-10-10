import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { recognizePage } from '../../../src/actions';
import { Icon } from '../../../src/components/Icon';
import { useStore } from '../../../src/store';
import { colors, space, withAlpha } from '../../../src/theme';

// Text recognised on the page that was open in the viewer.
export default function TextSheet() {
  const params = useLocalSearchParams<{ id: string; page?: string }>();
  const doc = useStore((state) => state.docs.find((item) => item.id === params.id));
  const stored = useStore((state) => state.text);
  const index = Number(params.page ?? 0);
  const page = doc?.pages[index] ?? doc?.pages[0];
  const isProtected = Boolean(doc?.protected);
  const docId = doc?.id;
  // For protected documents the text is recognised here and kept in memory only.
  const [live, setLive] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!isProtected || !docId || !page) {
      return;
    }
    let active = true;
    recognizePage({ id: docId, protected: true }, page)
      .then((value) => {
        if (active) {
          setLive(value);
        }
      })
      .catch(() => {
        if (active) {
          setLive('');
        }
      });
    return () => {
      active = false;
    };
    // Keyed on the stored file so an unrelated library update does not repeat the recognition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProtected, docId, page?.file]);

  if (!doc || !page) {
    return <View style={styles.fill} />;
  }

  const value = isProtected ? live : stored[page.id];
  const pending = value === undefined;

  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Text</Text>
          <Text style={styles.meta}>
            Page {Math.min(index + 1, doc.pages.length)} of {doc.pages.length}
          </Text>
        </View>
        {value ? (
          <Pressable
            hitSlop={10}
            onPress={() => Share.share({ message: value })}
            style={({ pressed }) => [styles.share, pressed && { opacity: 0.6 }]}>
            <Icon name="square.and.arrow.up" size={18} color={colors.text} />
          </Pressable>
        ) : null}
      </View>
      {pending ? (
        <ActivityIndicator color={colors.textDim} style={{ marginTop: 48 }} />
      ) : value ? (
        <Text selectable style={styles.body}>
          {value}
        </Text>
      ) : (
        <Text style={styles.none}>No text found on this page.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: colors.navy,
  },
  content: {
    padding: space.lg,
    paddingTop: 34,
    paddingBottom: 48,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.lg,
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  meta: {
    color: colors.textFaint,
    fontSize: 14,
    marginTop: 4,
  },
  share: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(colors.accent, 0.2),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairlineStrong,
  },
  body: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 24,
  },
  none: {
    color: colors.textDim,
    fontSize: 15,
    textAlign: 'center',
    marginTop: 48,
  },
});
