import { useState, type ReactNode } from 'react';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { border, borderWidths, focusRing, foreground, semantic, shape, spacing, surface, touchTarget, typography } from '@/theme/tokens';
import { RiskBadge, StatusBadge, Surface } from './ui';

type DashboardCardProps = {
  title: string;
  children?: ReactNode;
  actionLabel?: string;
  href?: '/inventory' | '/expiry' | '/transfers' | '/reports' | '/pos';
  testID?: string;
};

function CardAction({ actionLabel, href }: Pick<DashboardCardProps, 'actionLabel' | 'href'>) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  if (!actionLabel || !href) return null;
  return (
    <Link href={href} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={actionLabel} focusable onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)} style={StyleSheet.flatten([styles.action, focused && styles.actionFocused, pressed && styles.actionPressed])}>
        <Text style={styles.actionText}>{actionLabel}</Text>
      </Pressable>
    </Link>
  );
}

export function MetricCard({ title, children, actionLabel, href, testID }: DashboardCardProps) {
  return <Surface testID={testID} tone="default" style={styles.card}><Text style={styles.title}>{title}</Text><View style={styles.metricContent}>{children}</View><CardAction actionLabel={actionLabel} href={href} /></Surface>;
}

export function AttentionCard({ title, level, label, children, actionLabel, href, testID }: DashboardCardProps & { level: 'low' | 'medium' | 'high' | 'critical'; label: string }) {
  const tone = level === 'critical' ? semantic.danger : level === 'high' ? semantic.warning : semantic.info;
  return <Surface testID={testID} tone="default" style={[styles.card, { borderColor: tone.border }]}><View style={styles.cardHeading}><Text style={styles.title}>{title}</Text><RiskBadge label={label} level={level} /></View><View style={styles.metricContent}>{children}</View><CardAction actionLabel={actionLabel} href={href} /></Surface>;
}

export function ActionCard({ title, description, label, href, testID }: { title: string; description: string; label: string; href: '/inventory' | '/expiry' | '/transfers' | '/reports' | '/pos'; testID?: string }) {
  return <Surface testID={testID} tone="inset" style={styles.actionCard}><View style={styles.actionCopy}><Text style={styles.title}>{title}</Text><Text style={styles.description}>{description}</Text></View><CardAction actionLabel={label} href={href} /></Surface>;
}

export function ReadModelStatus({ label, tone = 'success' }: { label: string; tone?: 'success' | 'warning' | 'info' }) {
  return <StatusBadge label={label} tone={tone} />;
}

const styles = StyleSheet.create({
  card: { flexGrow: 1, flexBasis: 260, minWidth: 240, gap: spacing.md },
  cardHeading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.sm },
  title: { ...typography.cardTitle, color: foreground.primary },
  metricContent: { minHeight: 72, gap: spacing.sm },
  action: { alignSelf: 'flex-start', minHeight: touchTarget, justifyContent: 'center', borderWidth: borderWidths.hairline, borderColor: border.default, borderRadius: shape.md, paddingHorizontal: spacing.md },
  actionFocused: { borderColor: focusRing.color, borderWidth: focusRing.width },
  actionPressed: { backgroundColor: surface.inset, borderColor: focusRing.color },
  actionText: { ...typography.body, color: foreground.brand, fontWeight: '800' },
  actionCard: { flexGrow: 1, flexBasis: 240, minWidth: 220, gap: spacing.md },
  actionCopy: { gap: spacing.xs },
  description: { ...typography.supporting, color: foreground.secondary },
});
