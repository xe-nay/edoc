import { useWindowDimensions } from 'react-native';

// Columns for a grid: the phone layout's count, more on a tablet (and more again when it is
// held sideways), so that cells keep roughly the size they have on a phone.
export function useColumns(phoneColumns: number, cellWidth: number) {
  const { width } = useWindowDimensions();
  return Math.max(phoneColumns, Math.floor(width / cellWidth));
}

// Splits items into rows of `columns`.
export function rowsOf<T>(items: T[], columns: number) {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += columns) {
    rows.push(items.slice(index, index + columns));
  }
  return rows;
}
