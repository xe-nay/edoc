import type { IconName } from './Icon';

export type BarAction = {
  icon?: IconName;
  label: string;
  onPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  // Shows a checkmark when used inside a menu.
  on?: boolean;
  // Filled, tinted button for the main action of a bar.
  prominent?: boolean;
  // Turns the item into a pull-down menu (or a submenu when nested).
  menu?: BarAction[];
};

export type BarItem = BarAction | 'space' | 'search';
