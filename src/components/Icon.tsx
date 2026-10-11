import { SymbolView, type SymbolViewProps, type SymbolWeight } from 'expo-symbols';
import type { ColorValue, StyleProp, ViewStyle } from 'react-native';

import { colors } from '../theme';

export type IconName = Extract<SymbolViewProps['name'], string>;

// Material names used only by the browser design preview; the iPhone renders SF Symbols.
const previewNames: Partial<Record<IconName, string>> = {
  'folder.fill': 'folder',
  'tray.full.fill': 'inbox',
  'doc.viewfinder': 'document_scanner',
  'doc.fill': 'description',
  'doc.text.fill': 'description',
  'doc.on.doc': 'content_copy',
  gearshape: 'settings',
  plus: 'add',
  'chevron.right': 'chevron_right',
  'lock.fill': 'lock',
  faceid: 'familiar_face_and_zone',
  'square.and.arrow.up': 'ios_share',
  trash: 'delete',
  'star.fill': 'star',
  star: 'star',
  calendar: 'calendar_today',
  'calendar.badge.clock': 'event',
  clock: 'schedule',
  'person.fill': 'person',
  'briefcase.fill': 'work',
  magnifyingglass: 'search',
  checkmark: 'check',
  xmark: 'close',
  'rotate.right': 'rotate_right',
  'arrow.left': 'arrow_back',
  'arrow.right': 'arrow_forward',
  'camera.filters': 'tune',
  'text.viewfinder': 'text_fields',
  'info.circle': 'info',
  ellipsis: 'more_horiz',
  'photo.on.rectangle': 'photo_library',
  'folder.badge.plus': 'create_new_folder',
  'arrow.down.doc': 'download',
  externaldrive: 'hard_drive',
  icloud: 'cloud',
  'exclamationmark.triangle.fill': 'warning',
  'arrow.counterclockwise': 'restore',
  'square.grid.2x2': 'grid_view',
  'tag.fill': 'label',
  pencil: 'edit',
  'xmark.circle.fill': 'cancel',
  'square.and.arrow.down': 'download',
  'plus.viewfinder': 'add_a_photo',
};

type Props = {
  name: IconName;
  size?: number;
  color?: ColorValue;
  weight?: SymbolWeight;
  style?: StyleProp<ViewStyle>;
};

export function Icon({ name, size = 22, color = colors.text, weight = 'medium', style }: Props) {
  const preview = (previewNames[name] ?? 'circle') as never;
  return (
    <SymbolView
      name={{ ios: name, android: preview, web: preview }}
      size={size}
      tintColor={color}
      weight={weight}
      style={style}
    />
  );
}
