import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { scanMorePages, sharePdf } from '../../../src/actions';
import { BottomBar, HeaderBar } from '../../../src/components/Bars';
import { askDelete, askMove, askRename } from '../../../src/doc-menu';
import { showError, success, tap } from '../../../src/native-ui';
import { pageUri } from '../../../src/storage';
import { useStore } from '../../../src/store';
import { colors } from '../../../src/theme';

export default function DocScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const doc = useStore((state) => state.docs.find((item) => item.id === id));
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);

  if (!doc) {
    return <View style={styles.fill} />;
  }

  // Space kept clear for the navigation bar above and the toolbar below.
  const top = insets.top + 52;
  const bottom = insets.bottom + 64;
  const frameWidth = width - 28;
  const frameHeight = height - top - bottom;

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    if (next !== index) {
      setIndex(next);
    }
  };

  const share = async () => {
    tap();
    setBusy(true);
    try {
      await sharePdf(doc.id);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const addPages = async () => {
    try {
      if ((await scanMorePages(doc.id)) > 0) {
        success();
      }
    } catch (error) {
      showError(error);
    }
  };

  const open = (screen: 'pages' | 'info' | 'text') =>
    router.push({ pathname: `/doc/[id]/${screen}`, params: { id: doc.id, page: String(index) } });

  return (
    <View style={styles.fill}>
      <FlatList
        data={doc.pages}
        keyExtractor={(page) => page.id + page.file}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={32}
        initialNumToRender={2}
        windowSize={3}
        getItemLayout={(_, itemIndex) => ({ length: width, offset: width * itemIndex, index: itemIndex })}
        renderItem={({ item }) => {
          const scale = Math.min(frameWidth / item.width, frameHeight / item.height);
          return (
            <ScrollView
              style={{ width, height }}
              contentContainerStyle={[styles.page, { width, height, paddingTop: top, paddingBottom: bottom }]}
              maximumZoomScale={5}
              minimumZoomScale={1}
              bouncesZoom
              centerContent
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              contentInsetAdjustmentBehavior="never">
              <Image
                source={{ uri: pageUri(doc.id, item.file) }}
                contentFit="contain"
                style={[styles.sheet, { width: item.width * scale, height: item.height * scale }]}
              />
            </ScrollView>
          );
        }}
      />

      <View pointerEvents="none" style={[styles.counter, { bottom: bottom + 6 }]}>
        <Text style={styles.counterText}>
          {Math.min(index + 1, doc.pages.length)} / {doc.pages.length}
        </Text>
      </View>

      {busy ? (
        <View pointerEvents="none" style={styles.busy}>
          <ActivityIndicator color={colors.text} />
        </View>
      ) : null}

      <Stack.Screen options={{ title: doc.name }} />
      <HeaderBar
        items={[
          {
            icon: 'ellipsis',
            label: 'More',
            menu: [
              { icon: 'pencil', label: 'Rename', onPress: () => askRename(doc) },
              { icon: 'folder.fill', label: 'Move', onPress: () => askMove(doc) },
              {
                icon: doc.favorite ? 'star.fill' : 'star',
                label: doc.favorite ? 'Remove from Favorites' : 'Add to Favorites',
                onPress: () => useStore.getState().updateDoc(doc.id, { favorite: !doc.favorite }),
              },
              {
                icon: 'trash',
                label: 'Delete',
                destructive: true,
                onPress: () => askDelete(doc, () => router.back()),
              },
            ],
          },
        ]}
      />
      <BottomBar
        items={[
          { icon: 'square.and.arrow.up', label: 'Share PDF', onPress: share },
          'space',
          { icon: 'square.grid.2x2', label: 'Pages', onPress: () => open('pages') },
          { icon: 'text.viewfinder', label: 'Text', onPress: () => open('text') },
          { icon: 'info.circle', label: 'Details', onPress: () => open('info') },
          'space',
          { icon: 'plus.viewfinder', label: 'Add Pages', onPress: addPages },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: colors.black,
  },
  page: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    borderRadius: 6,
    backgroundColor: colors.paper,
  },
  counter: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 12,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    backgroundColor: 'rgba(20, 30, 60, 0.72)',
  },
  counterText: {
    color: colors.textDim,
    fontSize: 12.5,
    fontWeight: '600',
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
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
});
