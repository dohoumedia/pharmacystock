import { hasDecimalPrecision, parseLocaleNumber, validDateOnly } from './numericInput';

export type ReceiptDraftInput = { quantity: string; unitCost: string; sellingPrice: string; lotNumber: string; expiryDate: string };
export type ReceiptRowIssue = { id: string; fields: string[] };

/** Validate the intended rows before constructing a payload. Never discard an invalid intended row. */
export function validateReceiptRows(rows: { id: string; remaining: number; draft?: ReceiptDraftInput }[]) {
  const issues: ReceiptRowIssue[] = [];
  const lines: { purchaseOrderLineId: string; quantity: number; unitCost: number | null; sellingPrice: number; lotNumber: string; expiryDate: string }[] = [];
  for (const row of rows) {
    const draft = row.draft;
    if (!draft || !draft.quantity.trim()) continue;
    const quantity = parseLocaleNumber(draft.quantity);
    const unitCost = draft.unitCost.trim() ? parseLocaleNumber(draft.unitCost) : null;
    const sellingPrice = parseLocaleNumber(draft.sellingPrice);
    const fields = [];
    if (quantity === null || quantity <= 0 || quantity > row.remaining || !hasDecimalPrecision(quantity, 3)) fields.push('quantity');
    if (draft.unitCost.trim() && (unitCost === null || unitCost < 0 || !hasDecimalPrecision(unitCost, 2))) fields.push('unitCost');
    if (sellingPrice === null || sellingPrice <= 0 || !hasDecimalPrecision(sellingPrice, 2)) fields.push('sellingPrice');
    if (!draft.lotNumber.trim()) fields.push('lotNumber');
    if (!validDateOnly(draft.expiryDate)) fields.push('expiryDate');
    if (fields.length) issues.push({ id: row.id, fields });
    else lines.push({ purchaseOrderLineId: row.id, quantity: quantity!, unitCost, sellingPrice: sellingPrice!, lotNumber: draft.lotNumber.trim(), expiryDate: draft.expiryDate });
  }
  return { issues, lines: issues.length ? [] : lines };
}
