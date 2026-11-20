import { useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from '../i18n/useTranslation';
import { Button } from './ui';
import { importColumns, type ImportType } from '../domain/importPreview';
import type { ColumnMapping } from '../domain/importMapping';
export function ImportColumnMapping({ headers, mapping, type, disabled, onChange }: { headers: string[]; mapping: ColumnMapping; type: ImportType; disabled: boolean; onChange: (mapping: ColumnMapping) => void }) {
  const { t } = useTranslation(); const [selected, setSelected] = useState<string|null>(null);
  return <View style={{ gap: 10 }}><Text>{t('imports.mappingHelp')}</Text>{headers.slice(0,30).map(header => <View key={header} style={{ gap: 6 }}>
    <Button variant="secondary" disabled={disabled} label={`${header} → ${mapping[header] ? t(`imports.fields.${mapping[header]}`) : t('imports.ignored')}`} onPress={() => setSelected(selected === header ? null : header)} />
    {selected === header ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{['', ...importColumns[type]].map(field => <Button key={field} disabled={disabled} variant="secondary" label={field ? `${t(`imports.fields.${field}`)} (${field})` : t('imports.ignored')} onPress={() => { onChange({ ...mapping, [header]: field }); setSelected(null); }} />)}</View> : null}
  </View>)}</View>;
}
