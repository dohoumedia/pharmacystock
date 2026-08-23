export const colors = {
  background: '#F6F8FC',
  surface: '#FFFFFF',
  text: '#101828',
  muted: '#667085',
  border: '#D0D5DD',
  primary: '#102A5C',
  accent: '#00B8E6',
  success: '#027A48',
  warning: '#B54708',
  danger: '#B42318',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radii = { sm: 8, md: 10, lg: 16, pill: 999 } as const;
export const breakpoints = { compact: 640, tablet: 900, desktop: 1200 } as const;
export const touchTarget = 44;
