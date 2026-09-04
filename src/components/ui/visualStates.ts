import { border, borderWidths, breakpoints, colors, disabledOpacity, focusRing, foreground, semantic, surface, touchTarget } from '../../theme/tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type InteractionState = { disabled?: boolean; focused?: boolean; hovered?: boolean; pressed?: boolean };

const buttonTones = {
  primary: { backgroundColor: colors.primary, borderColor: colors.primary, color: foreground.inverse },
  secondary: { backgroundColor: surface.default, borderColor: border.default, color: colors.primary },
  danger: { backgroundColor: semantic.danger.foreground, borderColor: semantic.danger.foreground, color: foreground.inverse },
  ghost: { backgroundColor: 'transparent', borderColor: 'transparent', color: colors.primary },
} as const;

export function buttonVisualStyle(variant: ButtonVariant, state: InteractionState = {}) {
  const tone = buttonTones[variant];
  return { minHeight: touchTarget, backgroundColor: state.pressed || (state.hovered && variant === 'secondary') ? (variant === 'secondary' ? surface.inset : tone.backgroundColor) : tone.backgroundColor, borderColor: state.focused ? focusRing.color : tone.borderColor, borderWidth: state.focused ? focusRing.width : borderWidths.hairline, opacity: state.disabled ? disabledOpacity : 1, transform: state.pressed ? [{ scale: 0.99 }] : undefined };
}

export type TextFieldState = { disabled?: boolean; focused?: boolean; error?: boolean };
export function textFieldVisualStyle(state: TextFieldState = {}) {
  return { minHeight: touchTarget, borderWidth: state.focused ? focusRing.width : borderWidths.hairline, borderColor: state.error ? semantic.danger.foreground : state.focused ? focusRing.color : border.default, backgroundColor: state.disabled ? surface.inset : surface.default, opacity: state.disabled ? disabledOpacity : 1 };
}

export type BadgeTone = keyof typeof semantic | 'neutral';
export function badgeTone(tone: BadgeTone) {
  if (tone === 'neutral') return { backgroundColor: surface.inset, borderColor: border.subtle, color: colors.muted };
  const value = semantic[tone];
  return { backgroundColor: value.background, borderColor: value.border, color: value.foreground };
}

export function pageHeaderLayout(width: number) { return width < breakpoints.tablet ? 'stacked' : 'inline'; }
