import * as LocalAuthentication from 'expo-local-authentication';
import { usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { useStore } from '../store';
import { colors, withAlpha } from '../theme';
import { Icon } from './Icon';
import { Glow } from './ui';

// Sheets are presented above the app's root view, so they are closed before locking.
const sheetRoutes = /\/(info|text|folder-color)$/;

// Covers the app while it is in the app switcher and asks for Face ID on return.
export function LockGate({ children }: { children: ReactNode }) {
  const enabled = useStore((state) => state.settings.faceId);
  const router = useRouter();
  const pathname = usePathname();
  const [locked, setLocked] = useState(enabled);
  const [covered, setCovered] = useState(false);
  const prompting = useRef(false);
  const lockedRef = useRef(locked);
  const pathRef = useRef(pathname);
  lockedRef.current = locked;
  pathRef.current = pathname;

  const unlock = useCallback(async () => {
    if (prompting.current) {
      return;
    }
    prompting.current = true;
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock eDoc',
        cancelLabel: 'Cancel',
      });
      if (result.success) {
        setLocked(false);
      }
    } finally {
      prompting.current = false;
    }
  }, []);

  useEffect(() => {
    if (lockedRef.current) {
      unlock();
    }
  }, [unlock]);

  useEffect(() => {
    if (!enabled) {
      setLocked(false);
      setCovered(false);
      return;
    }
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setCovered(false);
        if (lockedRef.current) {
          unlock();
        }
        return;
      }
      setCovered(true);
      if (state === 'background' && !prompting.current) {
        if (sheetRoutes.test(pathRef.current) && router.canGoBack()) {
          router.back();
        }
        setLocked(true);
      }
    });
    return () => subscription.remove();
  }, [enabled, router, unlock]);

  return (
    <View style={styles.fill}>
      {children}
      {locked || covered ? (
        <View style={[StyleSheet.absoluteFill, styles.cover]}>
          <Glow height={520} />
          <View style={styles.badge}>
            <Icon name="lock.fill" size={40} color={colors.accentSoft} weight="semibold" />
          </View>
          <Text style={styles.name}>eDoc</Text>
          {locked ? (
            <Pressable onPress={unlock} style={({ pressed }) => [styles.unlock, pressed && { opacity: 0.6 }]}>
              <Icon name="faceid" size={26} color={colors.text} weight="regular" />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: colors.black,
  },
  cover: {
    backgroundColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    width: 96,
    height: 96,
    borderRadius: 30,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(colors.accent, 0.14),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(colors.accentSoft, 0.4),
    shadowColor: colors.accent,
    shadowOpacity: 0.7,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
  },
  name: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginTop: 20,
  },
  unlock: {
    position: 'absolute',
    bottom: 96,
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(colors.accent, 0.22),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(colors.accentSoft, 0.5),
  },
});
