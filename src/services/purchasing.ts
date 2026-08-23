import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

type Supplier = {
  id: string;
  organization_id: string;
  name: string;
  code: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

type PurchaseOrder = {
  id: string;
  organization_id: string;
  branch_id: string;
  supplier_id: string;
  po_number: string;
  status: 'draft' | 'ordered' | 'partially_received' | 'received' | 'cancelled';
  ordered_at: string | null;
  expected_at: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type PurchaseOrderLine = {
  id: string;
  organization_id: string;
  purchase_order_id: string;
  product_id: string;
  ordered_quantity: number;
  received_quantity: number;
  unit_cost: number | null;
  created_at: string;
  updated_at: string;
};

type PurchaseReceipt = {
  id: string;
  organization_id: string;
  branch_id: string;
  purchase_order_id: string;
  receipt_number: string;
  supplier_invoice_number: string | null;
  received_at: string;
  received_by: string;
  notes: string | null;
  created_at: string;
};

type PurchasingDatabase = {
  public: {
    Tables: {
      suppliers: {
        Row: Supplier;
        Insert: Omit<Supplier, 'id' | 'created_at' | 'updated_at'> & { id?: string; created_at?: string; updated_at?: string };
        Update: Partial<Omit<Supplier, 'id' | 'organization_id' | 'created_at'>>;
        Relationships: [];
      };
      purchase_orders: {
        Row: PurchaseOrder;
        Insert: Omit<PurchaseOrder, 'id' | 'created_by' | 'created_at' | 'updated_at'> & { id?: string; created_by?: string; created_at?: string; updated_at?: string };
        Update: Partial<Omit<PurchaseOrder, 'id' | 'organization_id' | 'created_by' | 'created_at'>>;
        Relationships: [];
      };
      purchase_order_lines: {
        Row: PurchaseOrderLine;
        Insert: Omit<PurchaseOrderLine, 'id' | 'received_quantity' | 'created_at' | 'updated_at'> & { id?: string; received_quantity?: number; created_at?: string; updated_at?: string };
        Update: Partial<Omit<PurchaseOrderLine, 'id' | 'organization_id' | 'purchase_order_id' | 'created_at'>>;
        Relationships: [];
      };
      purchase_receipts: { Row: PurchaseReceipt; Insert: never; Update: never; Relationships: [] };
    };
    Views: Record<string, never>;
    Functions: {
      receive_purchase_order: {
        Args: {
          p_purchase_order_id: string;
          p_receipt_number: string;
          p_supplier_invoice_number?: string | null;
          p_lines?: unknown;
          p_notes?: string | null;
        };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

const db = supabase as unknown as SupabaseClient<PurchasingDatabase>;

export type PurchaseOrderWithSupplier = PurchaseOrder & { supplier_name: string };
export type PurchaseOrderLineWithProduct = PurchaseOrderLine & { product_name: string };

export async function loadSuppliers(organizationId: string): Promise<Supplier[]> {
  const { data, error } = await db.from('suppliers').select('*').eq('organization_id', organizationId).order('name');
  if (error) throw error;
  return data;
}

export async function createSupplier(input: {
  organizationId: string;
  name: string;
  code?: string;
  phone?: string;
  email?: string;
  address?: string;
}): Promise<Supplier> {
  const { data, error } = await db.from('suppliers').insert({
    organization_id: input.organizationId,
    name: input.name.trim(),
    code: input.code?.trim() || null,
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    address: input.address?.trim() || null,
    status: 'active',
  }).select('*').single();
  if (error) throw error;
  return data;
}

export async function loadPurchaseOrders(organizationId: string, branchId: string): Promise<PurchaseOrderWithSupplier[]> {
  const [{ data: orders, error }, suppliers] = await Promise.all([
    db.from('purchase_orders').select('*').eq('organization_id', organizationId).eq('branch_id', branchId).order('created_at', { ascending: false }),
    loadSuppliers(organizationId),
  ]);
  if (error) throw error;
  const names = new Map(suppliers.map((item) => [item.id, item.name]));
  return orders.map((order) => ({ ...order, supplier_name: names.get(order.supplier_id) ?? order.supplier_id.slice(0, 8) }));
}

export async function createPurchaseOrder(input: {
  organizationId: string;
  branchId: string;
  supplierId: string;
  poNumber: string;
  expectedAt?: string;
  notes?: string;
  lines: { productId: string; quantity: number; unitCost?: number | null }[];
}): Promise<string> {
  const { data: order, error } = await db.from('purchase_orders').insert({
    organization_id: input.organizationId,
    branch_id: input.branchId,
    supplier_id: input.supplierId,
    po_number: input.poNumber.trim(),
    status: 'ordered',
    ordered_at: new Date().toISOString(),
    expected_at: input.expectedAt?.trim() || null,
    notes: input.notes?.trim() || null,
  }).select('*').single();
  if (error) throw error;

  const rows = input.lines.filter((line) => line.quantity > 0).map((line) => ({
    organization_id: input.organizationId,
    purchase_order_id: order.id,
    product_id: line.productId,
    ordered_quantity: line.quantity,
    unit_cost: line.unitCost ?? null,
  }));
  if (!rows.length) throw new Error('PURCHASE_ORDER_REQUIRES_LINES');
  const { error: lineError } = await db.from('purchase_order_lines').insert(rows);
  if (lineError) throw lineError;
  return order.id;
}

export async function loadPurchaseOrderLines(organizationId: string, purchaseOrderId: string, productNames: Map<string, string>): Promise<PurchaseOrderLineWithProduct[]> {
  const { data, error } = await db.from('purchase_order_lines').select('*').eq('organization_id', organizationId).eq('purchase_order_id', purchaseOrderId).order('created_at');
  if (error) throw error;
  return data.map((line) => ({ ...line, product_name: productNames.get(line.product_id) ?? line.product_id.slice(0, 8) }));
}

export async function receivePurchaseOrder(input: {
  purchaseOrderId: string;
  receiptNumber: string;
  supplierInvoiceNumber?: string;
  notes?: string;
  lines: { purchaseOrderLineId: string; quantity: number; unitCost?: number | null; lotNumber: string; expiryDate: string }[];
}): Promise<string> {
  const payload = input.lines.filter((line) => line.quantity > 0).map((line) => ({
    purchase_order_line_id: line.purchaseOrderLineId,
    quantity: line.quantity,
    unit_cost: line.unitCost ?? null,
    lot_number: line.lotNumber.trim(),
    expiry_date: line.expiryDate.trim(),
  }));
  if (!payload.length) throw new Error('RECEIPT_REQUIRES_LINES');
  const { data, error } = await db.rpc('receive_purchase_order', {
    p_purchase_order_id: input.purchaseOrderId,
    p_receipt_number: input.receiptNumber.trim(),
    p_supplier_invoice_number: input.supplierInvoiceNumber?.trim() || null,
    p_lines: payload,
    p_notes: input.notes?.trim() || null,
  });
  if (error) throw error;
  return data;
}

export async function loadReceipts(organizationId: string, branchId: string): Promise<PurchaseReceipt[]> {
  const { data, error } = await db.from('purchase_receipts').select('*').eq('organization_id', organizationId).eq('branch_id', branchId).order('received_at', { ascending: false }).limit(100);
  if (error) throw error;
  return data;
}

export type { Supplier, PurchaseOrder, PurchaseOrderLine, PurchaseReceipt };
