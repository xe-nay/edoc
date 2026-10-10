import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';

import { queueText, resetTemp, secureStorage } from '../src/actions';
import { LockGate } from '../src/components/LockGate';
import { useStore } from '../src/store';
import { colors } from '../src/theme';

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.black,
    card: colors.black,
    text: colors.text,
    border: 'transparent',
  },
};

// iOS 26 draws glass bars with a soft scroll edge on its own; older versions get a blur.
const legacyBars = Platform.OS === 'ios' && Number.parseInt(String(Platform.Version), 10) < 26;

const sheet = {
  presentation: 'formSheet',
  headerShown: false,
  sheetGrabberVisible: true,
  sheetCornerRadius: 30,
  contentStyle: { backgroundColor: colors.navy },
} as const;

export default function RootLayout() {
  const ready = useStore((state) => state.ready);

  useEffect(() => {
    useStore.getState().hydrate();
    resetTemp();
    secureStorage().catch(() => {});
    queueText();
  }, []);

  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: colors.black }} />;
  }

  return (
    <ThemeProvider value={theme}>
      <StatusBar style="light" />
      <LockGate>
        <Stack
          screenOptions={{
            headerTransparent: Platform.OS === 'ios',
            headerBlurEffect: legacyBars ? 'systemChromeMaterialDark' : undefined,
            headerShadowVisible: false,
            headerTintColor: colors.text,
            headerBackButtonDisplayMode: 'minimal',
            headerTitleStyle: { color: colors.text, fontWeight: '600' },
            headerLargeTitleStyle: { color: colors.text },
            contentStyle: { backgroundColor: colors.black },
          }}>
          <Stack.Screen name="index" options={{ title: 'eDoc', headerLargeTitle: true }} />
          <Stack.Screen name="folder/[id]" options={{ title: '', headerLargeTitle: true }} />
          <Stack.Screen name="doc/[id]/index" options={{ title: '' }} />
          <Stack.Screen name="doc/[id]/pages" options={{ title: 'Pages' }} />
          <Stack.Screen name="doc/[id]/info" options={{ ...sheet, sheetAllowedDetents: [0.64, 1] }} />
          <Stack.Screen name="doc/[id]/text" options={{ ...sheet, sheetAllowedDetents: [0.64, 1] }} />
          <Stack.Screen name="folder-color" options={{ ...sheet, sheetAllowedDetents: [0.34] }} />
          <Stack.Screen name="settings" options={{ title: 'Settings', headerLargeTitle: true }} />
        </Stack>
      </LockGate>
    </ThemeProvider>
  );
}
