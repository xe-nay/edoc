import * as LocalAuthentication from 'expo-local-authentication';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import {
  discardBackup,
  pickBackup,
  restoreBackup,
  secureStorage,
  type PickedBackup,
  type RestoreMode,
} from '../src/actions';
import { lockName } from '../src/auth';
import { Icon, type IconName } from '../src/components/Icon';
import { Glow, SectionLabel } from '../src/components/ui';
import { chooseOption, deviceName, promptSecret, showError, success } from '../src/native-ui';
import { storageBytes } from '../src/storage';
import { useStore } from '../src/store';
import { colors, radius, space } from '../src/theme';

// Lets the current native dialog finish dismissing before the next one appears.
function later(action: () => void) {
  setTimeout(action, 400);
}

const isIOS = Platform.OS === 'ios';

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function Row({
  icon,
  label,
  onPress,
  children,
  last,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  children?: React.ReactNode;
  last?: boolean;
}) {
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
      <View style={styles.rowIcon}>
        <Icon name={icon} size={17} color={colors.accentSoft} />
      </View>
      <View style={[styles.rowBody, !last && styles.rowDivider]}>
        <Text style={styles.rowLabel}>{label}</Text>
        {children ?? <Icon name="chevron.right" size={12} color={colors.textFaint} weight="semibold" />}
      </View>
    </Pressable>
  );
}

export default function SettingsScreen() {
  const faceId = useStore((state) => state.settings.faceId);
  const deviceBackup = useStore((state) => state.settings.deviceBackup);
  const protectNew = useStore((state) => state.settings.protectNew);
  const count = useStore((state) => state.docs.length);
  const router = useRouter();
  const [busy, setBusy] = useState<'restore' | null>(null);

  const toggleFaceId = async (next: boolean) => {
    if (Platform.OS === 'web') {
      useStore.getState().updateSettings({ faceId: next });
      return;
    }
    try {
      if (next && !(await LocalAuthentication.isEnrolledAsync())) {
        Alert.alert(`${lockName} is not set up`, 'Set up a screen lock in the Settings app first.');
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: next ? `Turn on ${lockName} for eDoc` : `Turn off ${lockName} for eDoc`,
      });
      if (result.success) {
        useStore.getState().updateSettings({ faceId: next });
        success();
      }
    } catch (error) {
      showError(error);
    }
  };

  const doRestore = async (picked: PickedBackup, password: string | null, mode: RestoreMode) => {
    setBusy('restore');
    try {
      await restoreBackup(picked, password, mode);
      success();
    } catch (error) {
      discardBackup(picked);
      showError(error);
    } finally {
      setBusy(null);
    }
  };

  const askPassword = (picked: PickedBackup, mode: RestoreMode) => {
    if (!picked.sealed) {
      doRestore(picked, null, mode);
      return;
    }
    later(() =>
      promptSecret(
        'Backup Password',
        undefined,
        (password) => doRestore(picked, password, mode),
        () => discardBackup(picked),
      ),
    );
  };

  // A backup made on an iPhone or an Android phone can either be added to what is
  // here, or take the place of everything.
  const runRestore = async () => {
    try {
      const picked = await pickBackup();
      if (!picked) {
        return;
      }
      later(() =>
        chooseOption(
          [
            { label: 'Add to My Documents', onPress: () => askPassword(picked, 'merge') },
            {
              label: 'Replace Everything',
              destructive: true,
              onPress: () =>
                later(() =>
                  Alert.alert('Replace everything?', 'All documents currently in eDoc are removed first.', [
                    { text: 'Cancel', style: 'cancel', onPress: () => discardBackup(picked) },
                    { text: 'Replace', style: 'destructive', onPress: () => askPassword(picked, 'replace') },
                  ]),
                ),
            },
          ],
          'Restore Backup',
        ),
      );
    } catch (error) {
      showError(error);
    }
  };
  return (
    <>
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={styles.fill} contentContainerStyle={styles.content}>
        <SectionLabel>Privacy</SectionLabel>
        <View style={styles.group}>
          <Row icon="faceid" label={lockName}>
            <Switch value={faceId} onValueChange={toggleFaceId} trackColor={{ true: colors.accent }} />
          </Row>
          <Row icon="lock.fill" label="Protect New Documents" last={!isIOS}>
            <Switch
              value={protectNew}
              onValueChange={(next) => useStore.getState().updateSettings({ protectNew: next })}
              trackColor={{ true: colors.accent }}
            />
          </Row>
          {isIOS ? (
          <Row icon="icloud" label="Include in iPhone Backups" last>
            <Switch
              value={deviceBackup}
              onValueChange={(next) => {
                useStore.getState().updateSettings({ deviceBackup: next });
                secureStorage().catch(showError);
              }}
              trackColor={{ true: colors.accent }}
            />
          </Row>
          ) : null}
        </View>
        <Text style={styles.footnote}>
          {!isIOS
            ? 'Documents stay on this phone. They are not part of any cloud or computer backup.'
            : deviceBackup
            ? 'Documents are part of the iCloud and computer backups of this iPhone.'
            : 'Documents never leave this iPhone, not even in its iCloud or computer backups.'}
        </Text>

        <View style={styles.gap} />
        <SectionLabel>Backup</SectionLabel>
        <View style={styles.group}>
          <Row icon="square.and.arrow.up" label="Export Backup" onPress={busy ? undefined : () => router.push('/export')} />
          <Row icon="arrow.counterclockwise" label="Restore Backup" onPress={busy ? undefined : runRestore} last>
            {busy === 'restore' ? <ActivityIndicator color={colors.textDim} /> : undefined}
          </Row>
        </View>
        <Text style={styles.footnote}>
          A backup is one file with the documents you choose, encrypted with your password. It opens on iPhone and
          Android alike, and is the only way to recover protected documents if this {deviceName} or the app is lost.
        </Text>

        <View style={styles.gap} />
        <SectionLabel>Storage</SectionLabel>
        <View style={styles.group}>
          <Row icon="externaldrive" label={count === 1 ? '1 document' : `${count} documents`} last>
            <Text style={styles.value}>{formatBytes(storageBytes())}</Text>
          </Row>
        </View>
        <Text style={styles.footnote}>eDoc never connects to the internet.</Text>
      </ScrollView>
      <Glow />
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
    paddingBottom: 60,
  },
  gap: {
    height: space.xl,
  },
  group: {
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    paddingLeft: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(61, 123, 255, 0.16)',
  },
  rowBody: {
    flex: 1,
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 16,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  rowLabel: {
    color: colors.text,
    fontSize: 16,
  },
  value: {
    color: colors.textDim,
    fontSize: 16,
    fontVariant: ['tabular-nums'],
  },
  footnote: {
    color: colors.textFaint,
    fontSize: 12.5,
    lineHeight: 17,
    marginTop: 10,
    marginHorizontal: 6,
  },
});
