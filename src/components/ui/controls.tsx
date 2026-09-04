import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';
import { colors, foreground, shape, semantic, spacing, touchTarget, typography } from '../../theme/tokens';
import { BodyText, MetadataText, SupportingText } from './typography';
import { badgeTone, buttonVisualStyle, textFieldVisualStyle, type BadgeTone, type ButtonVariant } from './visualStates';

type ButtonProps = { label: string; onPress?: () => void; variant?: ButtonVariant; disabled?: boolean; loading?: boolean; accessibilityLabel?: string; icon?: ReactNode; style?: StyleProp<ViewStyle>; testID?: string };
export function Button({ label, onPress, variant = 'primary', disabled = false, loading = false, accessibilityLabel, icon, style, testID }: ButtonProps) {
  const unavailable = disabled || loading;
  const textColor = variant === 'secondary' || variant === 'ghost' ? colors.primary : foreground.inverse;
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled: unavailable, busy: loading }} disabled={unavailable} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onPress={onPress} style={({ pressed }) => [styles.button, buttonVisualStyle(variant, { disabled: unavailable, focused, hovered, pressed }), style]}>
    {loading ? <ActivityIndicator color={textColor} /> : null}
    {!loading && icon ? <View accessible={false}>{icon}</View> : null}
    <Text style={[styles.buttonText, { color: textColor }]}>{label}</Text>
  </Pressable>;
}

export function IconButton({ accessibilityLabel, onPress, disabled = false, children, style, testID }: { accessibilityLabel: string; onPress?: () => void; disabled?: boolean; children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled }} disabled={disabled} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onPress={onPress} style={({ pressed }) => [styles.iconButton, buttonVisualStyle('secondary', { disabled, focused, hovered, pressed }), style]}>{children}</Pressable>;
}

export function TextField({ error, accessibilityLabel, editable = true, style, onFocus, onBlur, ...props }: TextInputProps & { error?: boolean; accessibilityLabel: string; style?: StyleProp<TextStyle> }) {
  const [focused, setFocused] = useState(false);
  return <TextInput {...props} accessibilityLabel={accessibilityLabel} editable={editable} onFocus={(event) => { setFocused(true); onFocus?.(event); }} onBlur={(event) => { setFocused(false); onBlur?.(event); }} style={[styles.textField, textFieldVisualStyle({ disabled: !editable, focused, error }), style]} />;
}

export function FormField({ label, hint, error, required = false, children, testID }: { label: string; hint?: string; error?: string; required?: boolean; children: ReactNode; testID?: string }) {
  return <View testID={testID} style={styles.formField}><BodyText style={styles.fieldLabel}>{label}{required ? ' *' : ''}</BodyText>{children}{error ? <SupportingText accessibilityRole="alert" style={styles.error}>{error}</SupportingText> : hint ? <MetadataText>{hint}</MetadataText> : null}</View>;
}

export type AlertTone = 'success' | 'warning' | 'danger' | 'info';
export function Alert({ tone, title, children, accessibilityLabel, style, testID }: { tone: AlertTone; title: string; children?: ReactNode; accessibilityLabel?: string; style?: StyleProp<ViewStyle>; testID?: string }) {
  const toneStyle = badgeTone(tone);
  return <View testID={testID} accessibilityRole={tone === 'danger' || tone === 'warning' ? 'alert' : 'summary'} accessibilityLabel={accessibilityLabel ?? title} style={[styles.alert, toneStyle, style]}><Text style={[styles.alertTitle, { color: toneStyle.color }]}>{title}</Text>{children ? <SupportingText>{children}</SupportingText> : null}</View>;
}

export function StatusBadge({ label, tone = 'neutral', accessibilityLabel, style, testID }: { label: string; tone?: BadgeTone; accessibilityLabel?: string; style?: StyleProp<ViewStyle>; testID?: string }) {
  const toneStyle = badgeTone(tone);
  return <View testID={testID} accessibilityRole="text" accessibilityLabel={accessibilityLabel ?? label} style={[styles.badge, toneStyle, style]}><View accessible={false} style={[styles.badgeDot, { backgroundColor: toneStyle.color }]} /><Text style={[styles.badgeText, { color: toneStyle.color }]}>{label}</Text></View>;
}

export function RiskBadge({ label, level, accessibilityLabel, style, testID }: { label: string; level: 'low' | 'medium' | 'high' | 'critical'; accessibilityLabel?: string; style?: StyleProp<ViewStyle>; testID?: string }) {
  const tone: BadgeTone = level === 'low' ? 'success' : level === 'medium' ? 'info' : level === 'high' ? 'warning' : 'danger';
  return <StatusBadge label={label} tone={tone} accessibilityLabel={accessibilityLabel} style={style} testID={testID} />;
}

const styles = StyleSheet.create({
  button: { minHeight: touchTarget, borderRadius: shape.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg },
  buttonText: { ...typography.body, fontWeight: '800', textAlign: 'center' },
  iconButton: { width: touchTarget, minHeight: touchTarget, borderRadius: shape.md, alignItems: 'center', justifyContent: 'center' },
  textField: { minHeight: touchTarget, borderRadius: shape.md, paddingHorizontal: spacing.md, color: foreground.primary, ...typography.body },
  formField: { gap: spacing.xs }, fieldLabel: { fontWeight: '700' }, error: { color: semantic.danger.foreground },
  alert: { borderWidth: 1, borderRadius: shape.md, padding: spacing.md, gap: spacing.xs }, alertTitle: { ...typography.cardTitle },
  badge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderWidth: 1, borderRadius: shape.pill, paddingHorizontal: spacing.sm, minHeight: 28 }, badgeDot: { width: 8, height: 8, borderRadius: 4 }, badgeText: { ...typography.metadata },
});
