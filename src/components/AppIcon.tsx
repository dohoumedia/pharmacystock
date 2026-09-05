import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { foreground, typography } from '@/theme/tokens';

export type AppIconName =
  | 'home' | 'pos' | 'inventory' | 'purchasing' | 'expiry' | 'transfers'
  | 'reports' | 'customers' | 'products' | 'batches' | 'operations' | 'signOut';

const glyphs: Record<AppIconName, string> = {
  home: '⌂', pos: '▣', inventory: '▤', purchasing: '↓', expiry: '◷', transfers: '⇄',
  reports: '▥', customers: '◉', products: '⊞', batches: '▦', operations: '⚙', signOut: '⇥',
};

/** The parent always supplies the accessible name and visible text label. */
export function AppIcon({ name, color = foreground.secondary, size = 18, style, testID }: {
  name: AppIconName; color?: string; size?: number; style?: StyleProp<ViewStyle>; testID?: string;
}) {
  return <View testID={testID} accessible={false} style={[styles.container, style]}><Text style={[styles.glyph, { color, fontSize: size }]}>{glyphs[name]}</Text></View>;
}

const styles = StyleSheet.create({
  container: { width: 24, alignItems: 'center', justifyContent: 'center' },
  glyph: { ...typography.cardTitle, textAlign: 'center', lineHeight: 22 },
});
