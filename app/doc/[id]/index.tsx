import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { scanMorePages } from '../../../src/actions';
import { confirmIdentity } from '../../../src/auth';
import { BottomBar, HeaderBar } from '../../../src/components/Bars';
import { Icon } from '../../../src/components/Icon';
import { PageImage } from '../../../src/components/PageImage';
import { Zoomable } from '../../../src/components/Zoomable';
import { askDelete, askDuplicate, askMove, askRename, askSharePassword, shareDoc } from '../../../src/doc-menu';
import { showError, success, tap } from '../../../src/native-ui';
import { useStore } from '../../../src/store';
import { colors } from '../../../src/theme';

export default function DocScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const doc = useStore((state) => state.docs.find((item) => item.id === id));
  const insets = useSafeAreaInsets();
  const { width, height: windowHeight } = useWindowDimensions();
  // Height actually available to this screen, measured once it is laid out.
  const [area, setArea] = useState(0);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  // A protected document asks for Face ID, fingerprint or the passcode when the app-wide lock is off.
  const appLock = useStore((state) => state.settings.faceId);
  const guarded = Platform.OS !== 'web' && Boolean(doc?.protected) && !appLock;
  const [unlocked, setUnlocked] = useState(!guarded);

  useEffect(() => {
    if (unlocked) {
      return;
    }
    let active = true;
    confirmIdentity('Open protected document')
      .then((allowed) => {
        if (!active) {
          return;
        }
        if (allowed) {
          setUnlocked(true);
        } else {
          router.back();
        }
      })
      .catch(() => {
        if (active) {
          router.back();
        }
      });
    return () => {
      active = false;
    };
  }, [unlocked, router]);

  if (!doc) {
    return <View style={styles.fill} />;
  }
  if (!unlocked) {
    return (
      <View style={[styles.fill, styles.locked]}>
        <Icon name="lock.fill" size={34} color={colors.accentSoft} weight="semibold" />
      </View>
    );
  }

  // Space kept clear for the navigation bar above and the toolbar below. On iOS the bar floats
  // over the page; elsewhere it sits above the screen's own area.
  const height = area > 0 ? area : windowHeight;
  const top = Platform.OS === 'ios' ? insets.top + 52 : 12;
  const bottom = insets.bottom + (Platform.OS === 'ios' ? 64 : 84);
  const frameWidth = width - 28;
  const frameHeight = height - top - bottom;

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    if (next !== index) {
      setIndex(next);
    }
  };

  const share = async (password: string | null = null) => {
    tap();
    setBusy(true);
    try {
      await shareDoc(doc, password);
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
    <View style={styles.fill} onLayout={(event) => setArea(event.nativeEvent.layout.height)}>
      <FlatList
        data={doc.pages}
        keyExtractor={(page) => page.id + page.file}
        horizontal
        pagingEnabled
        scrollEnabled={!zoomed}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={32}
        initialNumToRender={2}
        windowSize={3}
        getItemLayout={(_, itemIndex) => ({ length: width, offset: width * itemIndex, index: itemIndex })}
        renderItem={({ item }) => {
          const scale = Math.min(frameWidth / item.width, frameHeight / item.height);
          return (
            <Zoomable width={width} height={height} top={top} bottom={bottom} onZoomChange={setZoomed}>
              <PageImage
                doc={doc}
                page={item}
                style={[styles.sheet, { width: item.width * scale, height: item.height * scale }]}
              />
            </Zoomable>
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
              {
                icon: 'doc.on.doc',
                label: 'Duplicate',
                onPress: () => askDuplicate(doc, (copyId) => router.replace({ pathname: '/doc/[id]', params: { id: copyId } })),
              },
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
          {
            icon: 'square.and.arrow.up',
            label: 'Share',
            menu: [
              { icon: 'square.and.arrow.up', label: 'Share PDF', onPress: () => share() },
              {
                icon: 'lock.fill',
                label: 'Share with Password',
                onPress: () => askSharePassword(doc, (password) => share(password)),
              },
            ],
          },
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
  locked: {
    alignItems: 'center',
    justifyContent: 'center',
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
