import { Text, View } from 'react-native';
import type { SaleQuote, PosProduct } from '../services/sales';
import { useTranslation } from '../i18n/useTranslation';
import { formatPosCurrency } from '../utils/posPresentation';
import { spacing } from '../theme/tokens';
export function QuoteAllocation({ quote, product, currency }: { quote: SaleQuote; product: PosProduct; currency: string }) {
  const { t, i18n } = useTranslation();
  const money = (n: number) => formatPosCurrency(Number(n), currency, i18n.language);
  return <View style={{ gap: spacing.xs }}>{quote.items.filter(i => i.product_id === product.id).map((item, index) => <View key={`${item.batch_id}:${index}`}><Text>{t('posReady.lot', { lot: item.lot_number ?? item.batch_id, expiry: item.expiry_date })}</Text><Text>{t('posReady.allocation', { quantity: Number(item.quantity).toLocaleString(i18n.language), price: money(item.unit_price), total: money(item.line_total) })}</Text></View>)}</View>;
}
