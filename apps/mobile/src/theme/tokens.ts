/** Design tokens. Forest green + fresh lime on warm ivory. Every screen reads from here. */
export const palette = {
  forest900: '#0B2E1C',
  forest800: '#124226',
  forest700: '#1F5C3A',
  forest600: '#2B7449',
  forest100: '#DCEBDD',
  lime500: '#B7E34A',
  lime400: '#C8EC6B',
  lime200: '#E6F5B8',
  ivory: '#FBF7EC',
  ivory2: '#F4EEDC',
  white: '#FFFFFF',
  ink: '#17301F',
  muted: '#667A6D',
  line: '#E8E4D6',
  danger: '#B93A2B',
  dangerBg: '#FBE9E6',
  warn: '#A8730A',
  warnBg: '#FDF1D4',
  info: '#1E5F8C',
  infoBg: '#E3F0F8',
} as const;

export interface Colors {
  bg: string; surface: string; surfaceAlt: string; text: string; textMuted: string; border: string;
  primary: string; onPrimary: string; accent: string; onAccent: string; primarySoft: string;
  danger: string; dangerBg: string; warn: string; warnBg: string; info: string; infoBg: string; success: string; successBg: string;
  overlay: string; shadow: string; skeleton: string;
}

export const lightColors: Colors = {
  bg: palette.ivory, surface: palette.white, surfaceAlt: palette.ivory2, text: palette.ink, textMuted: palette.muted,
  border: palette.line, primary: palette.forest700, onPrimary: palette.white, accent: palette.lime500, onAccent: palette.forest900,
  primarySoft: palette.forest100, danger: palette.danger, dangerBg: palette.dangerBg, warn: palette.warn, warnBg: palette.warnBg,
  info: palette.info, infoBg: palette.infoBg, success: palette.forest600, successBg: palette.forest100,
  overlay: 'rgba(11,46,28,0.45)', shadow: '#0B2E1C', skeleton: '#EEE9D8',
};

export const darkColors: Colors = {
  bg: '#0C1912', surface: '#14261B', surfaceAlt: '#1B3225', text: '#EAF2E6', textMuted: '#9DB3A3', border: '#254031',
  primary: '#7CC48F', onPrimary: '#0B2E1C', accent: palette.lime500, onAccent: palette.forest900, primarySoft: '#1E3B2A',
  danger: '#F08A7C', dangerBg: '#3A1D19', warn: '#E5B84F', warnBg: '#3A2E12', info: '#7DB9E0', infoBg: '#142B3A',
  success: '#7CC48F', successBg: '#1E3B2A', overlay: 'rgba(0,0,0,0.6)', shadow: '#000000', skeleton: '#1F362A',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;

export const fonts = {
  heading: 'Fraunces_600SemiBold',
  headingBold: 'Fraunces_700Bold',
  body: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const type = {
  display: { fontFamily: fonts.headingBold, fontSize: 32, lineHeight: 38, letterSpacing: -0.5 },
  h1: { fontFamily: fonts.heading, fontSize: 26, lineHeight: 32, letterSpacing: -0.3 },
  h2: { fontFamily: fonts.heading, fontSize: 20, lineHeight: 26 },
  h3: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22 },
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16, letterSpacing: 0.2 },
  button: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 20 },
} as const;

export const shadow = (c: Colors, level: 1 | 2 | 3 = 1) => ({
  shadowColor: c.shadow,
  shadowOpacity: [0.06, 0.1, 0.16][level - 1],
  shadowRadius: [6, 14, 24][level - 1],
  shadowOffset: { width: 0, height: [2, 6, 12][level - 1] },
  elevation: [2, 5, 9][level - 1],
});

export const MIN_TOUCH = 44;
