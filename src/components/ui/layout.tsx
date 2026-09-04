import type { ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { border, borderWidths, elevation, shape, spacing, surface } from '../../theme/tokens';
import { PageTitle, SupportingText } from './typography';
import { pageHeaderLayout } from './visualStates';

type ViewProps = { children?: ReactNode; style?: StyleProp<ViewStyle>; testID?: string };

export function Screen({ children, style, testID }: ViewProps) {
  return <View testID={testID} style={[styles.screen, style]}>{children}</View>;
}

export function Stack({ children, style, gap = spacing.lg, testID }: ViewProps & { gap?: number }) {
  return <View testID={testID} style={[styles.stack, { gap }, style]}>{children}</View>;
}

export function Inline({ children, style, gap = spacing.md, wrap = false, testID }: ViewProps & { gap?: number; wrap?: boolean }) {
  return <View testID={testID} style={[styles.inline, { gap, flexWrap: wrap ? 'wrap' : 'nowrap' }, style]}>{children}</View>;
}

export type SurfaceTone = 'default' | 'raised' | 'inset' | 'attention';
export function Surface({ children, style, tone = 'default', testID }: ViewProps & { tone?: SurfaceTone }) {
  return <View testID={testID} style={[styles.surface, styles[tone], style]}>{children}</View>;
}

export function Divider({ style, testID }: Omit<ViewProps, 'children'>) {
  return <View testID={testID} accessibilityElementsHidden style={[styles.divider, style]} />;
}

export function PageHeader({ title, subtitle, action, style, testID }: {
  title: string; subtitle?: string; action?: ReactNode; style?: StyleProp<ViewStyle>; testID?: string;
}) {
  const { width } = useWindowDimensions();
  const layout = pageHeaderLayout(width);
  return (
    <View testID={testID} style={[styles.pageHeader, layout === 'stacked' ? styles.stackedHeader : styles.inlineHeader, style]}>
      <View style={styles.headingCopy}>
        <PageTitle accessibilityRole="header">{title}</PageTitle>
        {subtitle ? <SupportingText>{subtitle}</SupportingText> : null}
      </View>
      {action ? <View style={layout === 'stacked' ? styles.stackedAction : styles.inlineAction}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: surface.canvas, padding: spacing.lg },
  stack: { flexDirection: 'column' },
  inline: { flexDirection: 'row', alignItems: 'center' },
  surface: { borderRadius: shape.lg, borderWidth: borderWidths.hairline, borderColor: border.default, padding: spacing.lg },
  default: { backgroundColor: surface.default },
  raised: { backgroundColor: surface.raised, ...elevation.raised },
  inset: { backgroundColor: surface.inset },
  attention: { backgroundColor: surface.warning, borderColor: border.warning },
  divider: { height: borderWidths.hairline, backgroundColor: border.subtle, width: '100%' },
  pageHeader: { gap: spacing.md },
  inlineHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  stackedHeader: { flexDirection: 'column' },
  headingCopy: { flexShrink: 1, gap: spacing.xs },
  inlineAction: { flexShrink: 0 },
  stackedAction: { alignSelf: 'stretch' },
});
