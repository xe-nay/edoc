import { useMemo, useRef, type ReactNode } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  type GestureResponderEvent,
} from 'react-native';

type Props = {
  width: number;
  height: number;
  // Space kept clear above and below the page.
  top: number;
  bottom: number;
  children: ReactNode;
  // Lets the pager stop swiping between pages while one of them is zoomed in.
  onZoomChange?: (zoomed: boolean) => void;
};

const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 280;

function spread(event: GestureResponderEvent) {
  const [a, b] = event.nativeEvent.touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

// One page of the viewer with pinch, double-tap and drag. iOS uses the system scroll view's
// zoom; elsewhere the gestures are handled here.
export function Zoomable({ width, height, top, bottom, children, onZoomChange }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const x = useRef(new Animated.Value(0)).current;
  const y = useRef(new Animated.Value(0)).current;
  const state = useRef({
    scale: 1,
    x: 0,
    y: 0,
    startScale: 1,
    startX: 0,
    startY: 0,
    startSpread: 0,
    pinched: false,
    lastTap: 0,
  }).current;

  const responder = useMemo(() => {
    const move = (nextScale: number, nextX: number, nextY: number, animated = false) => {
      const limitX = (width * (nextScale - 1)) / 2;
      const limitY = (height * (nextScale - 1)) / 2;
      state.scale = nextScale;
      state.x = Math.max(-limitX, Math.min(limitX, nextX));
      state.y = Math.max(-limitY, Math.min(limitY, nextY));
      if (animated) {
        Animated.parallel([
          Animated.spring(scale, { toValue: state.scale, useNativeDriver: true, bounciness: 0 }),
          Animated.spring(x, { toValue: state.x, useNativeDriver: true, bounciness: 0 }),
          Animated.spring(y, { toValue: state.y, useNativeDriver: true, bounciness: 0 }),
        ]).start();
      } else {
        scale.setValue(state.scale);
        x.setValue(state.x);
        y.setValue(state.y);
      }
    };

    const tap = () => {
      const now = Date.now();
      if (now - state.lastTap < DOUBLE_TAP_MS) {
        state.lastTap = 0;
        const zoomIn = state.scale <= 1.01;
        move(zoomIn ? DOUBLE_TAP_SCALE : 1, 0, 0, true);
        onZoomChange?.(zoomIn);
      } else {
        state.lastTap = now;
      }
    };

    const pan = PanResponder.create({
      onStartShouldSetPanResponder: (event) => event.nativeEvent.touches.length >= 2 || state.scale > 1.01,
      onMoveShouldSetPanResponder: (event) => event.nativeEvent.touches.length >= 2 || state.scale > 1.01,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        state.startScale = state.scale;
        state.startX = state.x;
        state.startY = state.y;
        state.startSpread = event.nativeEvent.touches.length >= 2 ? spread(event) : 0;
        state.pinched = false;
      },
      onPanResponderMove: (event, gesture) => {
        if (event.nativeEvent.touches.length >= 2) {
          const distance = spread(event);
          if (!state.startSpread) {
            state.startSpread = distance;
            state.startScale = state.scale;
          }
          state.pinched = true;
          const next = Math.max(1, Math.min(MAX_SCALE, (state.startScale * distance) / state.startSpread));
          move(next, state.x, state.y);
        } else if (!state.pinched && state.scale > 1.01) {
          move(state.scale, state.startX + gesture.dx, state.startY + gesture.dy);
        }
      },
      onPanResponderRelease: (_, gesture) => {
        if (!state.pinched && Math.abs(gesture.dx) < 6 && Math.abs(gesture.dy) < 6) {
          tap();
          return;
        }
        if (state.scale <= 1.05) {
          move(1, 0, 0, true);
        }
        onZoomChange?.(state.scale > 1.05);
      },
    });
    return { pan, tap };
  }, [width, height, onZoomChange, scale, x, y, state]);

  if (Platform.OS === 'ios') {
    return (
      <ScrollView
        style={{ width, height }}
        contentContainerStyle={[styles.center, { width, height, paddingTop: top, paddingBottom: bottom }]}
        maximumZoomScale={MAX_SCALE}
        minimumZoomScale={1}
        bouncesZoom
        centerContent
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never">
        {children}
      </ScrollView>
    );
  }

  return (
    <Animated.View
      {...responder.pan.panHandlers}
      style={[
        styles.center,
        { width, height, paddingTop: top, paddingBottom: bottom },
        { transform: [{ translateX: x }, { translateY: y }, { scale }] },
      ]}>
      <Pressable onPress={responder.tap}>{children}</Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
