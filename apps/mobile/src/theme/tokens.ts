import { Platform, StyleSheet } from 'react-native';

/**
 * DressIt design tokens. Editorial, warm and quiet: paper-like off-white,
 * near-black ink and a single restrained accent ("arcilla"). All text pairs
 * below meet WCAG AA (≥ 4.5:1) on `background` and `surface`.
 */
export interface Palette {
  background: string;
  surface: string;
  surfaceAlt: string;
  surfaceInverse: string;
  ink: string;
  inkMuted: string;
  inkSubtle: string;
  inkInverse: string;
  line: string;
  lineStrong: string;
  accent: string;
  accentInk: string;
  accentSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;
  scrim: string;
  skeleton: string;
  skeletonHighlight: string;
}

export const lightPalette: Palette = {
  background: '#F6F2EC',
  surface: '#FFFDF9',
  surfaceAlt: '#EFE9E1',
  surfaceInverse: '#171513',
  ink: '#171513',
  inkMuted: '#5B554F',
  inkSubtle: '#8A837B',
  inkInverse: '#F6F2EC',
  line: '#E3DCD3',
  lineStrong: '#C9C0B5',
  accent: '#93452D',
  accentInk: '#FFFFFF',
  accentSoft: '#F3E3DB',
  success: '#2F6346',
  successSoft: '#E2EEE5',
  warning: '#7A5A12',
  warningSoft: '#F5ECD5',
  danger: '#A3322A',
  dangerSoft: '#F7E1DE',
  info: '#34547A',
  infoSoft: '#E2EAF3',
  scrim: 'rgba(23,21,19,0.45)',
  skeleton: '#ECE5DC',
  skeletonHighlight: '#F6F1EA',
};

export const darkPalette: Palette = {
  background: '#121110',
  surface: '#1B1917',
  surfaceAlt: '#25221F',
  surfaceInverse: '#F3EEE7',
  ink: '#F3EEE7',
  inkMuted: '#B8B0A6',
  inkSubtle: '#8C857C',
  inkInverse: '#171513',
  line: '#2E2A26',
  lineStrong: '#433E38',
  accent: '#E0957A',
  accentInk: '#1A0F0B',
  accentSoft: '#3A241C',
  success: '#86C29C',
  successSoft: '#1D2E23',
  warning: '#E2C06C',
  warningSoft: '#33290F',
  danger: '#F08A80',
  dangerSoft: '#3A1D1A',
  info: '#9DBCE3',
  infoSoft: '#1C2735',
  scrim: 'rgba(0,0,0,0.6)',
  skeleton: '#25221F',
  skeletonHighlight: '#2F2B27',
};

export const fonts = {
  display: 'InstrumentSerif_400Regular',
  displayItalic: 'InstrumentSerif_400Regular_Italic',
  sans: 'InstrumentSans_400Regular',
  sansMedium: 'InstrumentSans_500Medium',
  sansSemiBold: 'InstrumentSans_600SemiBold',
  sansBold: 'InstrumentSans_700Bold',
} as const;

export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
  giant: 72,
} as const;

export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 18,
  xl: 28,
  pill: 999,
} as const;

/** Minimum touch target (iOS HIG 44pt, Material 48dp → we use 44 and pad with hitSlop). */
export const touchTarget = 44;

export const hairline = StyleSheet.hairlineWidth;

export type TextVariant =
  | 'display'
  | 'title'
  | 'heading'
  | 'subheading'
  | 'body'
  | 'bodyStrong'
  | 'small'
  | 'smallStrong'
  | 'caption'
  | 'overline'
  | 'button'
  | 'quote';

export const typography: Record<
  TextVariant,
  { fontFamily: string; fontSize: number; lineHeight: number; letterSpacing?: number; textTransform?: 'uppercase' }
> = {
  display: { fontFamily: fonts.display, fontSize: 42, lineHeight: 46, letterSpacing: -0.5 },
  title: { fontFamily: fonts.display, fontSize: 32, lineHeight: 36, letterSpacing: -0.3 },
  heading: { fontFamily: fonts.display, fontSize: 25, lineHeight: 30 },
  subheading: { fontFamily: fonts.sansSemiBold, fontSize: 17, lineHeight: 24 },
  body: { fontFamily: fonts.sans, fontSize: 16, lineHeight: 24 },
  bodyStrong: { fontFamily: fonts.sansSemiBold, fontSize: 16, lineHeight: 24 },
  small: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 20 },
  smallStrong: { fontFamily: fonts.sansSemiBold, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fonts.sansMedium, fontSize: 12, lineHeight: 16 },
  overline: { fontFamily: fonts.sansSemiBold, fontSize: 11, lineHeight: 14, letterSpacing: 1.4, textTransform: 'uppercase' },
  button: { fontFamily: fonts.sansSemiBold, fontSize: 15, lineHeight: 20, letterSpacing: 0.2 },
  quote: { fontFamily: fonts.displayItalic, fontSize: 20, lineHeight: 26 },
};

export const elevation = {
  card: Platform.select({
    ios: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
    default: { elevation: 1 },
  }),
  sheet: Platform.select({
    ios: { shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 24, shadowOffset: { width: 0, height: -4 } },
    default: { elevation: 12 },
  }),
};

export const motion = {
  fast: 140,
  base: 220,
  slow: 360,
} as const;
