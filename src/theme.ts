export const colors = {
  black: '#000000',
  ink: '#03060F',
  navy: '#07112A',
  accent: '#3D7BFF',
  accentSoft: '#6FA4FF',
  cyan: '#4CC9FF',
  text: '#F4F7FF',
  textDim: 'rgba(214, 226, 255, 0.62)',
  textFaint: 'rgba(214, 226, 255, 0.36)',
  glass: 'rgba(120, 160, 255, 0.07)',
  glassStrong: 'rgba(120, 160, 255, 0.12)',
  hairline: 'rgba(150, 185, 255, 0.14)',
  hairlineStrong: 'rgba(150, 185, 255, 0.26)',
  danger: '#FF5A6E',
  warning: '#FFB547',
  paper: '#F6F7FA',
};

export const folderColors = [
  '#3D7BFF',
  '#4CC9FF',
  '#6E5BFF',
  '#A66BFF',
  '#2DD4BF',
  '#3DDC97',
  '#FFB547',
  '#FF6B8B',
  '#93A1BD',
];

export const radius = {
  sm: 12,
  md: 18,
  lg: 24,
  xl: 32,
};

export const space = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 20,
  xl: 28,
};

export function withAlpha(hex: string, alpha: number) {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
