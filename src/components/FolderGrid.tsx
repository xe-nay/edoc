import { useMemo, useRef, useState } from 'react';
import {
  Animated,
  LayoutAnimation,
  PanResponder,
  StyleSheet,
  View,
  type GestureResponderEvent,
} from 'react-native';

import { tap } from '../native-ui';
import { useStore } from '../store';
import type { Folder } from '../types';
import { FolderTile, TILE_HEIGHT } from './cards';
import type { IconName } from './Icon';

export type GridTile = {
  key: string;
  name: string;
  count: number;
  color: string;
  icon?: IconName;
  // Set for folders created by the user: only these can be dragged and edited.
  folder?: Folder;
  onPress: () => void;
};

type Props = {
  tiles: GridTile[];
  onMenu: (folder: Folder) => void;
  // Lets the screen stop scrolling while a folder is being dragged.
  onDragChange: (dragging: boolean) => void;
};

const GAP = 12;
const COLUMNS = 2;
// Holding a folder still for this long after it lifts opens its menu instead of dragging it.
const MENU_DELAY_MS = 700;
const MOVE_TOLERANCE = 8;

type Drag = { folder: Folder; tile: GridTile };

// Two-column folder grid. A long press lifts a folder so it can be dragged to a new place;
// holding it still a little longer opens its menu (rename, colour, delete).
export function FolderGrid({ tiles, onMenu, onDragChange }: Props) {
  const container = useRef<View>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const position = useRef(new Animated.ValueXY()).current;
  const state = useRef({
    drag: null as Drag | null,
    claimed: false,
    moved: false,
    width: 0,
    originX: 0,
    originY: 0,
    grabX: 0,
    grabY: 0,
    startX: 0,
    startY: 0,
    menuTimer: null as ReturnType<typeof setTimeout> | null,
    tiles,
    onMenu,
    onDragChange,
  }).current;
  state.tiles = tiles;
  state.onMenu = onMenu;
  state.onDragChange = onDragChange;

  const cellWidth = () => (state.width - GAP * (COLUMNS - 1)) / COLUMNS;

  const stop = () => {
    if (state.menuTimer) {
      clearTimeout(state.menuTimer);
      state.menuTimer = null;
    }
    if (state.drag) {
      state.drag = null;
      state.claimed = false;
      setDrag(null);
      state.onDragChange(false);
    }
  };

  const start = (tile: GridTile, event: GestureResponderEvent) => {
    if (!tile.folder) {
      return;
    }
    const { pageX, pageY } = event.nativeEvent;
    const folder = tile.folder;
    container.current?.measureInWindow((x, y, width) => {
      const index = state.tiles.findIndex((item) => item.key === tile.key);
      const left = (index % COLUMNS) * (cellWidth() + GAP);
      const top = Math.floor(index / COLUMNS) * (TILE_HEIGHT + GAP);
      state.width = width;
      state.originX = x;
      state.originY = y;
      state.grabX = pageX - x - left;
      state.grabY = pageY - y - top;
      state.startX = pageX;
      state.startY = pageY;
      state.moved = false;
      state.claimed = false;
      state.drag = { folder, tile };
      position.setValue({ x: left, y: top });
      setDrag(state.drag);
      state.onDragChange(true);
      tap();
      state.menuTimer = setTimeout(() => {
        if (state.drag && !state.moved) {
          stop();
          state.onMenu(folder);
        }
      }, MENU_DELAY_MS);
    });
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: () => state.drag !== null,
        onMoveShouldSetPanResponderCapture: () => state.drag !== null,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          state.claimed = true;
        },
        onPanResponderMove: (event) => {
          const current = state.drag;
          if (!current) {
            return;
          }
          const { pageX, pageY } = event.nativeEvent;
          if (!state.moved && Math.hypot(pageX - state.startX, pageY - state.startY) > MOVE_TOLERANCE) {
            state.moved = true;
            if (state.menuTimer) {
              clearTimeout(state.menuTimer);
              state.menuTimer = null;
            }
          }
          const x = pageX - state.originX;
          const y = pageY - state.originY;
          position.setValue({ x: x - state.grabX, y: y - state.grabY });

          // Which cell the finger is over; the fixed tiles at the start keep their places.
          const fixed = state.tiles.findIndex((item) => item.folder);
          const column = Math.max(0, Math.min(COLUMNS - 1, Math.floor(x / (cellWidth() + GAP))));
          const row = Math.max(0, Math.floor(y / (TILE_HEIGHT + GAP)));
          const target = Math.max(fixed, Math.min(state.tiles.length - 1, row * COLUMNS + column));
          const from = state.tiles.findIndex((item) => item.key === current.tile.key);
          if (state.moved && target !== from) {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            useStore.getState().moveFolder(current.folder.id, target - fixed);
          }
        },
        onPanResponderRelease: stop,
        onPanResponderTerminate: stop,
      }),
    // The handlers read everything from `state`, which is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const rows: GridTile[][] = [];
  for (let index = 0; index < tiles.length; index += COLUMNS) {
    rows.push(tiles.slice(index, index + COLUMNS));
  }

  return (
    <View
      ref={container}
      collapsable={false}
      onLayout={(event) => {
        state.width = event.nativeEvent.layout.width;
      }}
      style={styles.grid}
      {...responder.panHandlers}>
      {rows.map((row, index) => (
        <View key={index} style={styles.row}>
          {row.map((tile) => (
            <FolderTile
              key={tile.key}
              name={tile.name}
              icon={tile.icon}
              color={tile.color}
              count={tile.count}
              dimmed={drag?.tile.key === tile.key}
              onPress={tile.onPress}
              onLongPress={tile.folder ? (event) => start(tile, event) : undefined}
              // Lifting the finger without dragging puts the folder back down.
              onPressOut={() => {
                if (state.drag && !state.claimed) {
                  stop();
                }
              }}
            />
          ))}
          {row.length < COLUMNS ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
      {drag ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.floating, { width: cellWidth(), transform: position.getTranslateTransform() }]}>
          <FolderTile
            name={drag.tile.name}
            color={drag.tile.color}
            count={drag.tile.count}
            lifted
            onPress={() => {}}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: GAP,
  },
  row: {
    flexDirection: 'row',
    gap: GAP,
  },
  floating: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: TILE_HEIGHT,
    flexDirection: 'row',
  },
});
