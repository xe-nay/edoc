import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";

import { setExpiry, setProtected } from "../../../src/actions";
import { confirmIdentity } from "../../../src/auth";
import { DialogHost } from "../../../src/components/Dialogs";
import { Icon, type IconName } from "../../../src/components/Icon";
import {
  Chip,
  formatDate,
  pageCount,
  tagIcons,
  tagLabels,
} from "../../../src/components/ui";
import { askDelete, askMove, askRename } from "../../../src/doc-menu";
import {
  deviceName,
  pickDate,
  showError,
  success,
  suggestedExpiry,
} from "../../../src/native-ui";
import { useStore } from "../../../src/store";
import { colors, radius, space } from "../../../src/theme";
import type { Tag } from "../../../src/types";

const tags: Tag[] = ["personal", "professional"];

function Row({
  icon,
  label,
  children,
  onPress,
  last,
}: {
  icon: IconName;
  label: string;
  children?: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
    >
      <Icon name={icon} size={18} color={colors.accentSoft} />
      <View style={[styles.rowBody, !last && styles.rowDivider]}>
        <Text style={styles.rowLabel}>{label}</Text>
        <View style={styles.rowValue}>{children}</View>
      </View>
    </Pressable>
  );
}

export default function InfoSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const doc = useStore((state) => state.docs.find((item) => item.id === id));
  const folder = useStore((state) =>
    state.folders.find((item) => item.id === doc?.folderId),
  );
  const [protecting, setProtecting] = useState(false);

  if (!doc) {
    return <View style={styles.fill} />;
  }

  const toggleProtected = async (next: boolean) => {
    setProtecting(true);
    try {
      // Removing the protection decrypts the pages, so it needs the same proof as exporting.
      if (!next && !(await confirmIdentity("Remove protection"))) {
        return;
      }
      await setProtected(doc.id, next);
      success();
    } catch (error) {
      showError(error);
    } finally {
      setProtecting(false);
    }
  };

  const update = useStore.getState().updateDoc;

  const changeExpiry = (value: number | null) => {
    setExpiry(doc.id, value).catch(showError);
  };

  const openCalendar = () =>
    pickDate(
      "Expiry Date",
      doc.expiresAt === null ? suggestedExpiry() : new Date(doc.expiresAt),
      (day) => changeExpiry(day.getTime()),
    );

  return (
    <>
      <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
        <Pressable onPress={() => askRename(doc)} style={styles.title}>
          <Text numberOfLines={2} style={styles.name}>
            {doc.name}
          </Text>
          <Icon name="pencil" size={16} color={colors.textFaint} />
        </Pressable>
        <Text style={styles.meta}>
          {pageCount(doc.pages.length)} · {formatDate(doc.createdAt, true)}
        </Text>

        <View style={styles.tags}>
          <Chip
            label="None"
            active={doc.tag === null}
            onPress={() => update(doc.id, { tag: null })}
          />
          {tags.map((tag) => (
            <Chip
              key={tag}
              label={tagLabels[tag]}
              icon={tagIcons[tag]}
              active={doc.tag === tag}
              onPress={() => update(doc.id, { tag })}
            />
          ))}
        </View>

        <View style={styles.group}>
          <Row icon="folder.fill" label="Folder" onPress={() => askMove(doc)}>
            <Text style={styles.value}>{folder?.name ?? "None"}</Text>
            <Icon
              name="chevron.right"
              size={12}
              color={colors.textFaint}
              weight="semibold"
            />
          </Row>
          <Row icon="calendar.badge.clock" label="Expires">
            {doc.expiresAt === null ? (
              <Pressable hitSlop={10} onPress={openCalendar}>
                <Text style={styles.link}>Add Date</Text>
              </Pressable>
            ) : (
              <>
                <Pressable hitSlop={10} onPress={openCalendar}>
                  <Text style={styles.link}>
                    {formatDate(doc.expiresAt, true)}
                  </Text>
                </Pressable>
                <Pressable hitSlop={10} onPress={() => changeExpiry(null)}>
                  <Icon
                    name="xmark.circle.fill"
                    size={20}
                    color={colors.textFaint}
                  />
                </Pressable>
              </>
            )}
          </Row>
          <Row icon="star.fill" label="Favorite">
            <Switch
              value={doc.favorite}
              onValueChange={(favorite) => update(doc.id, { favorite })}
              trackColor={{ true: colors.accent }}
            />
          </Row>
          <Row icon="lock.fill" label="Protected" last>
            {protecting ? (
              <ActivityIndicator color={colors.textDim} />
            ) : (
              <Switch
                value={Boolean(doc.protected)}
                onValueChange={toggleProtected}
                trackColor={{ true: colors.accent }}
              />
            )}
          </Row>
        </View>
        {doc.protected ? (
          <Text style={styles.footnote}>
            Pages are encrypted with a key that exists only on this {deviceName}
            . Search finds this document by name only.
          </Text>
        ) : null}
        {doc.expiresAt !== null ? (
          <Text style={styles.footnote}>
            Reminders 30 days before, 5 days before and on the day.
          </Text>
        ) : null}

        <Pressable
          onPress={() => askDelete(doc, () => router.dismissTo("/"))}
          style={({ pressed }) => [styles.delete, pressed && { opacity: 0.6 }]}
        >
          <Icon name="trash" size={17} color={colors.danger} />
          <Text style={styles.deleteText}>Delete Document</Text>
        </Pressable>
      </ScrollView>
      <DialogHost />
    </>
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
  title: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  name: {
    flexShrink: 1,
    color: colors.text,
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: -0.4,
  },
  meta: {
    color: colors.textFaint,
    fontSize: 14,
    marginTop: 6,
  },
  tags: {
    flexDirection: "row",
    gap: 8,
    marginTop: space.lg,
  },
  group: {
    marginTop: space.lg,
    borderRadius: radius.lg,
    borderCurve: "continuous",
    backgroundColor: colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    paddingLeft: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  rowBody: {
    flex: 1,
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
  rowValue: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  value: {
    color: colors.textDim,
    fontSize: 16,
  },
  link: {
    color: colors.accentSoft,
    fontSize: 16,
    fontWeight: "600",
  },
  footnote: {
    color: colors.textFaint,
    fontSize: 12.5,
    marginTop: 10,
    marginLeft: 6,
  },
  delete: {
    marginTop: space.xl,
    height: 52,
    borderRadius: radius.md,
    borderCurve: "continuous",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(255, 90, 110, 0.1)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 90, 110, 0.3)",
  },
  deleteText: {
    color: colors.danger,
    fontSize: 16,
    fontWeight: "600",
  },
});
