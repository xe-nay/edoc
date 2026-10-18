import { useMemo, useRef, type ReactNode } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
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

function midpoint(event: GestureResponderEvent) {
  const [a, b] = event.nativeEvent.touches;
  return { x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2 };
}

// One page of the viewer with pinch, double-tap and drag. iOS uses the system scroll view's
// zoom; elsewhere the gestures are handled here.
export function Zoomable({ width, height, top, bottom, children, onZoomChange }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const x = useRef(new Animated.Value(0)).current;
  const y = useRef(new Animated.Value(0)).current;
  const frame = useRef<View>(null);
  const state = useRef({
    scale: 1,
    x: 0,
    y: 0,
    // The page's centre on screen, and the point of the page held under the fingers.
    centreX: 0,
    centreY: 0,
    anchorX: 0,
    anchorY: 0,
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

    const locate = () => {
      frame.current?.measureInWindow((left, topEdge, measuredWidth, measuredHeight) => {
        state.centreX = left + measuredWidth / 2;
        state.centreY = topEdge + measuredHeight / 2;
      });
    };

    // Remembers which point of the page is under the screen point (x, y), so it can stay there.
    const hold = (pointX: number, pointY: number) => {
      state.anchorX = (pointX - state.centreX - state.x) / state.scale;
      state.anchorY = (pointY - state.centreY - state.y) / state.scale;
    };

    // A double tap zooms in on the tapped spot, or back out.
    const tap = (event?: GestureResponderEvent) => {
      const now = Date.now();
      if (now - state.lastTap < DOUBLE_TAP_MS) {
        state.lastTap = 0;
        const zoomIn = state.scale <= 1.01;
        if (zoomIn && event) {
          const { pageX, pageY } = event.nativeEvent;
          hold(pageX, pageY);
          move(
            DOUBLE_TAP_SCALE,
            pageX - state.centreX - DOUBLE_TAP_SCALE * state.anchorX,
            pageY - state.centreY - DOUBLE_TAP_SCALE * state.anchorY,
            true,
          );
        } else {
          move(zoomIn ? DOUBLE_TAP_SCALE : 1, 0, 0, true);
        }
        onZoomChange?.(zoomIn);
      } else {
        state.lastTap = now;
        locate();
      }
    };

    const pan = PanResponder.create({
      onStartShouldSetPanResponder: (event) => event.nativeEvent.touches.length >= 2 || state.scale > 1.01,
      onMoveShouldSetPanResponder: (event) => event.nativeEvent.touches.length >= 2 || state.scale > 1.01,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        locate();
        state.startScale = state.scale;
        state.startX = state.x;
        state.startY = state.y;
        state.startSpread = 0;
        if (event.nativeEvent.touches.length >= 2) {
          state.startSpread = spread(event);
          const centre = midpoint(event);
          hold(centre.x, centre.y);
        }
        state.pinched = false;
      },
      onPanResponderMove: (event, gesture) => {
        if (event.nativeEvent.touches.length >= 2) {
          // The page grows around the point between the fingers, and follows them as they move.
          const distance = spread(event);
          const centre = midpoint(event);
          if (!state.startSpread) {
            state.startSpread = distance;
            state.startScale = state.scale;
            hold(centre.x, centre.y);
          }
          state.pinched = true;
          const next = Math.max(1, Math.min(MAX_SCALE, (state.startScale * distance) / state.startSpread));
          move(
            next,
            centre.x - state.centreX - next * state.anchorX,
            centre.y - state.centreY - next * state.anchorY,
          );
        } else if (!state.pinched && state.scale > 1.01) {
          move(state.scale, state.startX + gesture.dx, state.startY + gesture.dy);
        }
      },
      onPanResponderRelease: (event, gesture) => {
        if (!state.pinched && Math.abs(gesture.dx) < 6 && Math.abs(gesture.dy) < 6) {
          tap(event);
          return;
        }
        if (state.scale <= 1.05) {
          move(1, 0, 0, true);
        }
        onZoomChange?.(state.scale > 1.05);
      },
    });
    return { pan, tap, locate };
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
      ref={frame}
      onLayout={responder.locate}
      {...responder.pan.panHandlers}
      style={[
        styles.center,
        { width, height, paddingTop: top, paddingBottom: bottom },
        { transform: [{ translateX: x }, { translateY: y }, { scale }] },
      ]}>
      <Pressable onPress={(event) => responder.tap(event)}>{children}</Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
