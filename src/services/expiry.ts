import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export type ExpiryRisk = {
  organization_id: string | null;
  branch_id: string | null;
  batch_id: string | null;
  product_id: string | null;
  product_name: string | null;
  generic_name: string | null;
  lot_number: string | null;
  expiry_date: string | null;
  days_remaining: number | null;
  batch_status: string | null;
  on_hand_quantity: number | null;
  purchase_cost: number | null;
  value_at_risk: number | null;
  risk_bucket: string | null;
};

export type ExpiryAlert = {
  id: string;
  organization_id: string;
  branch_id: string;
  batch_id: string;
  alert_type: 'EXPIRY_WARNING' | 'EXPIRED';
  threshold_days: number;
  expiry_date_snapshot: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  created_at: string;
  resolved_at: string | null;
};

export type ExpiryAction = {
  id: string;
  organization_id: string;
  branch_id: string;
  batch_id: string;
  action_type: 'PRIORITIZE_SALE' | 'QUARANTINE' | 'RELEASE_QUARANTINE' | 'DISPOSE' | 'SUPPLIER_RETURN';
  quantity: number | null;
  reason: string | null;
  actor_user_id: string;
  metadata: unknown;
  created_at: string;
};

export type ExpiryPolicy = {
  organization_id: string;
  thresholds_days: number[];
  created_at: string;
  updated_at: string;
};

type ExpiryDatabase = {
  public: {
    Tables: {
      expiry_policies: {
        Row: ExpiryPolicy;
        Insert: { organization_id: string; thresholds_days?: number[]; created_at?: string; updated_at?: string };
        Update: { thresholds_days?: number[]; updated_at?: string };
        Relationships: [];
      };
      expiry_alerts: { Row: ExpiryAlert; Insert: never; Update: never; Relationships: [] };
      expiry_actions: { Row: ExpiryAction; Insert: never; Update: never; Relationships: [] };
    };
    Views: {
      expiry_risk: { Row: ExpiryRisk; Relationships: [] };
    };
    Functions: {
      refresh_expiry_alerts: { Args: { p_organization_id: string; p_branch_id?: string | null }; Returns: number };
      acknowledge_expiry_alert: { Args: { p_alert_id: string }; Returns: string };
      record_expiry_action: { Args: { p_batch_id: string; p_action_type: string; p_reason?: string | null }; Returns: string };
      dispose_batch: { Args: { p_batch_id: string; p_reason: string; p_idempotency_key: string }; Returns: string };
      return_batch_to_supplier: { Args: { p_batch_id: string; p_quantity: number; p_reason: string; p_idempotency_key: string }; Returns: string };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

const db = supabase as unknown as SupabaseClient<ExpiryDatabase>;

export async function refreshExpiryAlerts(organizationId: string, branchId: string): Promise<number> {
  const { data, error } = await db.rpc('refresh_expiry_alerts', { p_organization_id: organizationId, p_branch_id: branchId });
  if (error) throw error;
  return data;
}

export async function loadExpiryRisk(organizationId: string, branchId: string): Promise<ExpiryRisk[]> {
  const { data, error } = await db.from('expiry_risk').select('*').eq('organization_id', organizationId).eq('branch_id', branchId).order('expiry_date', { ascending: true });
  if (error) throw error;
  return data;
}

export async function loadExpiryAlerts(organizationId: string, branchId: string): Promise<ExpiryAlert[]> {
  const { data, error } = await db.from('expiry_alerts').select('*').eq('organization_id', organizationId).eq('branch_id', branchId).neq('status', 'RESOLVED').order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return data;
}

export async function loadExpiryActions(organizationId: string, branchId: string): Promise<ExpiryAction[]> {
  const { data, error } = await db.from('expiry_actions').select('*').eq('organization_id', organizationId).eq('branch_id', branchId).order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return data;
}

export async function loadExpiryPolicy(organizationId: string): Promise<ExpiryPolicy | null> {
  const { data, error } = await db.from('expiry_policies').select('*').eq('organization_id', organizationId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveExpiryPolicy(organizationId: string, thresholds: number[]): Promise<ExpiryPolicy> {
  const cleaned = [...new Set(thresholds.filter((value) => Number.isInteger(value) && value > 0))].sort((a, b) => b - a);
  if (!cleaned.length || cleaned.length > 10) throw new Error('INVALID_EXPIRY_THRESHOLDS');
  const { data, error } = await db.from('expiry_policies').upsert({ organization_id: organizationId, thresholds_days: cleaned }, { onConflict: 'organization_id' }).select('*').single();
  if (error) throw error;
  return data;
}

export async function acknowledgeExpiryAlert(alertId: string): Promise<string> {
  const { data, error } = await db.rpc('acknowledge_expiry_alert', { p_alert_id: alertId });
  if (error) throw error;
  return data;
}

export async function recordExpiryAction(batchId: string, actionType: 'PRIORITIZE_SALE' | 'QUARANTINE' | 'RELEASE_QUARANTINE', reason?: string): Promise<string> {
  const { data, error } = await db.rpc('record_expiry_action', { p_batch_id: batchId, p_action_type: actionType, p_reason: reason?.trim() || null });
  if (error) throw error;
  return data;
}

export async function disposeBatch(batchId: string, onHandBefore: number, reason: string): Promise<string> {
  const { data, error } = await db.rpc('dispose_batch', {
    p_batch_id: batchId,
    p_reason: reason.trim() || 'Expiry disposal',
    p_idempotency_key: `dispose:${batchId}:from:${onHandBefore}`,
  });
  if (error) throw error;
  return data;
}

export async function returnBatchToSupplier(batchId: string, onHandBefore: number, quantity: number, reason: string): Promise<string> {
  const { data, error } = await db.rpc('return_batch_to_supplier', {
    p_batch_id: batchId,
    p_quantity: quantity,
    p_reason: reason.trim() || 'Supplier return',
    p_idempotency_key: `supplier-return:${batchId}:from:${onHandBefore}:qty:${quantity}`,
  });
  if (error) throw error;
  return data;
}
