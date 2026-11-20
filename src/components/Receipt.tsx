import { Text, View } from 'react-native';
import { useTranslation } from '../i18n/useTranslation';
import { formatPosCurrency, formatPosDate, posStatusTranslationKey } from '../utils/posPresentation';
import { stockUnitLabel } from '../domain/stockUnits';
import { paymentKey } from '../domain/posCompletion';
import type { SaleDetailData } from '../services/posCompletion';
import { spacing, typography, foreground } from '../theme/tokens';

export type ReceiptContext = { timezone?: string; address?: string; contact?: string };
export function Receipt({ detail, business, branch, footer, timezone = 'UTC', address, contact }: { detail: SaleDetailData; business: string; branch: string; footer?: string | null } & ReceiptContext) {
  const { t, i18n } = useTranslation();
  const money = (n: number) => formatPosCurrency(Number(n), detail.sale.currency_code, i18n.language);
  const number = (n: number) => Number(n).toLocaleString(i18n.language);
  return <View testID="sale-receipt" style={{ gap: spacing.sm }}>
    <Text accessibilityRole="header" style={{ ...typography.sectionTitle, color: foreground.brand }}>{t('posReady.receiptTitle')} · {business}</Text>
    <Text>{t('posReady.branch')}: {branch}</Text>{address ? <Text>{address}</Text> : null}{contact ? <Text>{contact}</Text> : null}<Text>{detail.sale.sale_number}</Text>
    <Text>{t('posReady.date')}: {formatPosDate(detail.sale.completed_at, i18n.language, timezone)}</Text>
    <Text>{t('customersReady.customer')}: {detail.sale.customer_id ? (detail.customer?.full_name ?? t('customersReady.linkedCustomer')) : t('customersReady.walkIn')}</Text>
    <Text>{t('posReady.cashier')}: {detail.cashier}</Text><Text>{t('posReady.status')}: {t(posStatusTranslationKey(detail.sale.status))}</Text>
    {detail.items.map(item => { const product = detail.products.find(p => p.id === item.product_id); const batch = detail.batches.find(b => b.id === item.batch_id); return <View key={item.id} style={{ gap: 4, paddingVertical: 8 }}>
      <Text style={{ fontWeight: '700' }}>{product?.name ?? item.product_id} · {stockUnitLabel(product?.stock_unit, t)}</Text>
      <Text>{t('posReady.quantity')}: {number(item.quantity)} · {t('posReady.unitPrice')}: {money(item.unit_price)} · {t('posReady.lineTotal')}: {money(item.line_total)}</Text>
      <Text>{t('posReady.lot', { lot: batch?.lot_number ?? item.batch_id, expiry: batch?.expiry_date ?? '—' })}</Text>
      <Text>{t('posReady.movement', { reference: item.inventory_movement_id })}</Text>
    </View>; })}
    {Number(detail.sale.discount_total) > 0 ? <Text>{t('posReady.discount')}: {money(detail.sale.discount_total)}</Text> : null}
    <Text style={{ fontWeight: '800' }}>{t('posReady.total')}: {money(detail.sale.total_amount)}</Text>
    {detail.payments.map(payment => <View key={payment.id}><Text>{t('posReady.payment')}: {t(paymentKey(payment.method))} · {money(payment.amount)}</Text>{payment.external_reference ? <Text>{t('posReady.reference')}: {payment.external_reference}</Text> : null}{payment.tendered_amount != null ? <Text>{t('posReady.tender')}: {money(payment.tendered_amount)} · {t('posReady.change')}: {money(payment.change_amount ?? 0)}</Text> : null}</View>)}
    {footer ? <Text>{footer}</Text> : null}
  </View>;
}
