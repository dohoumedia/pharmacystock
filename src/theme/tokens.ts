/** Cross-platform visual language. Existing aliases remain while screens migrate. */
export const palette = {
  navy: { 950: '#071A3A', 900: '#0B234D', 800: '#102A5C', 700: '#173B75', 600: '#24539A' },
  teal: { 700: '#087F78', 600: '#0B9E95', 500: '#00B8B0', 400: '#3DCDC5' },
  cyan: { 700: '#0369A1', 600: '#0284C7', 500: '#00B8E6', 100: '#E0F2FE' },
  neutral: { 0: '#FFFFFF', 25: '#FCFDFE', 50: '#F6F8FC', 100: '#F2F4F7', 200: '#EAECF0', 300: '#D0D5DD', 400: '#98A2B3', 500: '#667085', 600: '#475467', 700: '#344054', 800: '#1D2939', 900: '#101828' },
  green: { 700: '#027A48', 100: '#D1FADF', 50: '#ECFDF3' },
  amber: { 700: '#B54708', 100: '#FEDF89', 50: '#FFFAEB' },
  red: { 700: '#B42318', 100: '#FECDCA', 50: '#FEF3F2' },
  blue: { 700: '#175CD3', 100: '#B2DDFF', 50: '#EFF8FF' },
  orange: { 100: '#FED7AA', 50: '#FFF7ED' },
} as const;

export const foreground = { primary: palette.neutral[900], secondary: palette.neutral[600], muted: palette.neutral[500], inverse: palette.neutral[0], brand: palette.navy[800], success: palette.green[700], warning: palette.amber[700], danger: palette.red[700], info: palette.blue[700] } as const;
export const surface = { canvas: palette.neutral[50], default: palette.neutral[0], raised: palette.neutral[0], inset: palette.neutral[100], brand: palette.navy[800], success: palette.green[50], warning: palette.amber[50], danger: palette.red[50], info: palette.blue[50], offline: palette.orange[50] } as const;
export const border = { subtle: palette.neutral[200], default: palette.neutral[300], strong: palette.neutral[400], focus: palette.cyan[500], success: palette.green[100], warning: palette.amber[100], danger: palette.red[100], info: palette.blue[100], offline: palette.orange[100] } as const;
export const semantic = {
  success: { foreground: foreground.success, background: surface.success, border: border.success },
  warning: { foreground: foreground.warning, background: surface.warning, border: border.warning },
  danger: { foreground: foreground.danger, background: surface.danger, border: border.danger },
  info: { foreground: foreground.info, background: surface.info, border: border.info },
  offline: { foreground: foreground.warning, background: surface.offline, border: border.offline },
  syncing: { foreground: foreground.info, background: surface.info, border: border.info },
  stale: { foreground: foreground.warning, background: surface.warning, border: border.warning },
  conflict: { foreground: foreground.danger, background: surface.danger, border: border.danger },
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, 4: 4, 8: 8, 12: 12, 16: 16, 20: 20, 24: 24, 32: 32, 40: 40, 48: 48, 64: 64 } as const;
/** New radius scale for all foundation primitives. */
export const shape = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;
/** Existing screen aliases; preserved until each screen opts into the new primitives. */
export const radii = { sm: 8, md: 10, lg: 16, pill: 999 } as const;
export const typography = {
  pageTitle: { fontSize: 28, lineHeight: 34, fontWeight: '800' }, sectionTitle: { fontSize: 20, lineHeight: 26, fontWeight: '800' }, cardTitle: { fontSize: 16, lineHeight: 22, fontWeight: '700' }, body: { fontSize: 14, lineHeight: 20, fontWeight: '400' }, supporting: { fontSize: 12, lineHeight: 18, fontWeight: '400' }, metadata: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
} as const;
export const borderWidths = { hairline: 1, focus: 2 } as const;
export const elevation = { none: {}, raised: { shadowColor: '#101828', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 1 } } as const;
export const focusRing = { color: border.focus, width: borderWidths.focus } as const;
export const disabledOpacity = 0.48;
export const touchTarget = 44;
export const breakpoints = { narrow: 480, compact: 640, tablet: 900, desktop: 1200, wide: 1440 } as const;

/** Compatibility aliases for existing application screens. */
export const colors = { background: surface.canvas, surface: surface.default, text: foreground.primary, muted: foreground.muted, border: border.default, primary: palette.navy[800], accent: palette.cyan[500], success: foreground.success, warning: foreground.warning, danger: foreground.danger } as const;
