import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';
import { foreground, typography } from '../../theme/tokens';

type TextProps = ComponentProps<typeof Text> & { children: ReactNode };
function Typography({ children, style, ...props }: TextProps) { return <Text {...props} style={style}>{children}</Text>; }
export function PageTitle(props: TextProps) { return <Typography {...props} style={[styles.pageTitle, props.style]} />; }
export function SectionTitle(props: TextProps) { return <Typography {...props} style={[styles.sectionTitle, props.style]} />; }
export function CardTitle(props: TextProps) { return <Typography {...props} style={[styles.cardTitle, props.style]} />; }
export function BodyText(props: TextProps) { return <Typography {...props} style={[styles.body, props.style]} />; }
export function SupportingText(props: TextProps) { return <Typography {...props} style={[styles.supporting, props.style]} />; }
export function MetadataText(props: TextProps) { return <Typography {...props} style={[styles.metadata, props.style]} />; }

const styles = StyleSheet.create({
  pageTitle: { ...typography.pageTitle, color: foreground.primary }, sectionTitle: { ...typography.sectionTitle, color: foreground.primary }, cardTitle: { ...typography.cardTitle, color: foreground.primary }, body: { ...typography.body, color: foreground.primary }, supporting: { ...typography.supporting, color: foreground.secondary }, metadata: { ...typography.metadata, color: foreground.muted },
});
