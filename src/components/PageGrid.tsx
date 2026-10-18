import { useMemo, useRef, useState } from 'react';
import {
  Animated,
  LayoutAnimation,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';

import { tap } from '../native-ui';
import { colors } from '../theme';
import type { Doc, Page } from '../types';
import { rowsOf } from '../columns';
import { PageImage } from './PageImage';

type Props = {
  doc: Doc;
  columns: number;
  selectedId: string | null;
  onSelect: (pageId: string) => void;
  // Moves the page at `from` to `to`, while it is being dragged.
  onMove: (from: number, to: number) => void;
  // Lets the screen stop scrolling while a page is being dragged.
  onDragChange: (dragging: boolean) => void;
};

const GAP = 12;
const ROW_GAP = 14;
const LABEL = 24;
const RATIO = 0.74;

// Page thumbnails in a grid. A long press lifts a page so it can be dragged to a new place.
export function PageGrid({ doc, columns, selectedId, onSelect, onMove, onDragChange }: Props) {
  const container = useRef<View>(null);
  const [dragged, setDragged] = useState<Page | null>(null);
  const position = useRef(new Animated.ValueXY()).current;
  const lift = useRef(new Animated.Value(1)).current;
  const state = useRef({
    page: null as Page | null,
    claimed: false,
    width: 0,
    originX: 0,
    originY: 0,
    grabX: 0,
    grabY: 0,
    pages: doc.pages,
    columns,
    onMove,
    onDragChange,
  }).current;
  state.pages = doc.pages;
  state.columns = columns;
  state.onMove = onMove;
  state.onDragChange = onDragChange;

  const cellWidth = () => (state.width - GAP * (state.columns - 1)) / state.columns;
  const cellHeight = () => cellWidth() / RATIO + LABEL;

  const stop = () => {
    if (state.page) {
      state.page = null;
      state.claimed = false;
      Animated.spring(lift, { toValue: 1, useNativeDriver: true, speed: 30 }).start();
      setDragged(null);
      state.onDragChange(false);
    }
  };

  const start = (page: Page, event: GestureResponderEvent) => {
    const { pageX, pageY } = event.nativeEvent;
    container.current?.measureInWindow((x, y, width) => {
      state.width = width;
      const index = state.pages.findIndex((item) => item.id === page.id);
      const left = (index % state.columns) * (cellWidth() + GAP);
      const top = Math.floor(index / state.columns) * (cellHeight() + ROW_GAP);
      state.originX = x;
      state.originY = y;
      state.grabX = pageX - x - left;
      state.grabY = pageY - y - top;
      state.claimed = false;
      state.page = page;
      position.setValue({ x: left, y: top });
      lift.setValue(1);
      Animated.spring(lift, { toValue: 1.06, useNativeDriver: true, speed: 24, bounciness: 6 }).start();
      setDragged(page);
      state.onDragChange(true);
      tap();
    });
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: () => state.page !== null,
        onMoveShouldSetPanResponderCapture: () => state.page !== null,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          state.claimed = true;
        },
        onPanResponderMove: (event) => {
          const current = state.page;
          if (!current) {
            return;
          }
          const x = event.nativeEvent.pageX - state.originX;
          const y = event.nativeEvent.pageY - state.originY;
          position.setValue({ x: x - state.grabX, y: y - state.grabY });
          const column = Math.max(0, Math.min(state.columns - 1, Math.floor(x / (cellWidth() + GAP))));
          const row = Math.max(0, Math.floor(y / (cellHeight() + ROW_GAP)));
          const target = Math.min(state.pages.length - 1, row * state.columns + column);
          const from = state.pages.findIndex((item) => item.id === current.id);
          if (from >= 0 && target !== from) {
            LayoutAnimation.configureNext(LayoutAnimation.create(180, 'easeInEaseOut', 'opacity'));
            state.onMove(from, target);
            tap();
          }
        },
        onPanResponderRelease: stop,
        onPanResponderTerminate: stop,
      }),
    // The handlers read everything from `state`, which is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const rows = rowsOf(doc.pages, columns);

  return (
    <View
      ref={container}
      collapsable={false}
      onLayout={(event) => {
        state.width = event.nativeEvent.layout.width;
      }}
      style={styles.grid}
      {...responder.panHandlers}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.row}>
          {row.map((page, columnIndex) => {
            const number = rowIndex * columns + columnIndex + 1;
            const selected = page.id === selectedId;
            return (
              <Pressable
                key={page.id + page.file}
                style={[styles.cell, dragged?.id === page.id && { opacity: 0.2 }]}
                onPress={() => onSelect(page.id)}
                onLongPress={(event) => start(page, event)}
                onPressOut={() => {
                  if (state.page && !state.claimed) {
                    stop();
                  }
                }}
                delayLongPress={280}>
                <View style={[styles.frame, selected && styles.frameSelected]}>
                  <PageImage doc={doc} page={page} maxDimension={520} contentFit="cover" style={styles.image} />
                </View>
                <Text style={[styles.number, selected && { color: colors.text }]}>{number}</Text>
              </Pressable>
            );
          })}
          {row.length < columns ? <View style={{ flex: columns - row.length }} /> : null}
        </View>
      ))}
      {dragged ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.floating,
            { width: cellWidth(), transform: [...position.getTranslateTransform(), { scale: lift }] },
          ]}>
          <View style={[styles.frame, styles.frameLifted]}>
            <PageImage doc={doc} page={dragged} maxDimension={520} contentFit="cover" style={styles.image} />
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: ROW_GAP,
  },
  row: {
    flexDirection: 'row',
    gap: GAP,
  },
  cell: {
    flex: 1,
    alignItems: 'center',
  },
  frame: {
    width: '100%',
    aspectRatio: RATIO,
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
  frameLifted: {
    borderColor: colors.accentSoft,
  },
  image: {
    flex: 1,
  },
  number: {
    color: colors.textFaint,
    fontSize: 12.5,
    fontWeight: '600',
    marginTop: 6,
    height: LABEL - 6,
    fontVariant: ['tabular-nums'],
  },
  floating: {
    position: 'absolute',
    left: 0,
    top: 0,
    shadowColor: colors.accent,
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
});
